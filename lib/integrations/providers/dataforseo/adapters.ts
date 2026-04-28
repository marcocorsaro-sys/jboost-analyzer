/**
 * DataForSEO adapters — trasformazioni raw → forma normalizzata interna JBA.
 *
 * I provider esterni hanno tipicamente payload ricchi e instabili (DataForSEO
 * cambia spesso lo shape dei `result`). Per isolare il resto del codebase JBA
 * dai cambiamenti del provider:
 *
 *   1. Validiamo i campi che ci interessano con Zod (graceful degradation se
 *      il provider aggiunge/rinomina cose che non usiamo).
 *   2. Riduciamo il payload alla nostra shape interna (`SerpScanResult`,
 *      `AIOverviewMention`, ecc.) che resta stabile.
 *
 * Il caller (use case in `lib/integrations/use-cases/`) lavora solo su queste
 * shape interne — niente `tasks[0].result[0].items[3].rich_snippet.parts...`.
 */

import { z } from 'zod'

// =========================================================================
// Schema Zod del raw DataForSEO (solo i campi che ci servono)
// =========================================================================

const SerpItemBaseSchema = z.object({
  type: z.string(), // organic | featured_snippet | ai_overview | people_also_ask | ...
  rank_group: z.number().optional(),
  rank_absolute: z.number().optional(),
  position: z.string().optional(),
  domain: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
})

const SerpResultSchema = z.object({
  keyword: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  se_domain: z.string().nullable().optional(),
  location_code: z.number().nullable().optional(),
  language_code: z.string().nullable().optional(),
  check_url: z.string().nullable().optional(),
  datetime: z.string().nullable().optional(),
  spell: z.unknown().nullable().optional(),
  refinement_chips: z.unknown().nullable().optional(),
  item_types: z.array(z.string()).nullable().optional(),
  se_results_count: z.number().nullable().optional(),
  items_count: z.number().nullable().optional(),
  items: z.array(z.record(z.unknown())).nullable().optional(),
})

const SerpTaskSchema = z.object({
  id: z.string(),
  status_code: z.number(),
  status_message: z.string(),
  cost: z.number().nullable().optional(),
  result_count: z.number().nullable().optional(),
  result: z.array(SerpResultSchema).nullable().optional(),
})

const SerpEnvelopeSchema = z.object({
  status_code: z.number(),
  status_message: z.string(),
  cost: z.number().nullable().optional(),
  tasks: z.array(SerpTaskSchema).nullable().optional(),
})

// =========================================================================
// Shape interne JBA (stable contract per i caller)
// =========================================================================

export interface SerpScanResult {
  keyword: string
  language: string | null
  /** True se la SERP contiene un blocco AI Overview di Google. */
  hasAIOverview: boolean
  /** True se la SERP contiene un Featured Snippet. */
  hasFeaturedSnippet: boolean
  /** True se la SERP contiene il blocco "People Also Ask". */
  hasPeopleAlsoAsk: boolean
  /** Top types della SERP (es. ['ai_overview', 'organic', 'people_also_ask']). */
  itemTypes: string[]
  /** Top 10 risultati organici. */
  topOrganic: SerpOrganicHit[]
  /** Posizione del dominio cliente, se passato e trovato (1..100). null altrimenti. */
  clientPosition: number | null
  /** URL della SERP visualizzabile (utile per debugging). */
  resultPageUrl: string | null
  /** Costo della chiamata in USD, dal cost field del provider. */
  costUsd: number | null
}

export interface SerpOrganicHit {
  rank: number
  domain: string
  url: string
  title: string
  description: string | null
}

export interface AIOverviewMention {
  keyword: string
  /** Estratto dell'AI Overview, se presente. */
  text: string | null
  /** Domini citati dall'AI Overview come fonti. */
  sourceDomains: string[]
}

// =========================================================================
// Adapters
// =========================================================================

/**
 * Trasforma una risposta `serp/google/organic/live/advanced` in `SerpScanResult`.
 *
 * @param rawEnvelope il payload top-level ritornato dal client
 * @param clientDomain dominio del cliente per cui calcolare la posizione (lowercase, senza www)
 */
export function adaptSerpOrganic(
  rawEnvelope: unknown,
  clientDomain?: string,
): SerpScanResult {
  const parsed = SerpEnvelopeSchema.safeParse(rawEnvelope)
  if (!parsed.success || !parsed.data.tasks?.length) {
    return emptySerpScanResult('', null)
  }

  const task = parsed.data.tasks[0]
  const result = task.result?.[0]
  const items = (result?.items ?? []) as Array<Record<string, unknown>>
  const itemTypes = result?.item_types ?? []
  const keyword = result?.keyword ?? ''
  const language = result?.language_code ?? null

  const organicHits: SerpOrganicHit[] = []
  for (const it of items) {
    if (it.type !== 'organic') continue
    const baseParse = SerpItemBaseSchema.safeParse(it)
    if (!baseParse.success) continue
    const rank = baseParse.data.rank_absolute ?? baseParse.data.rank_group ?? 0
    if (!baseParse.data.url || !baseParse.data.domain) continue
    organicHits.push({
      rank,
      domain: baseParse.data.domain,
      url: baseParse.data.url,
      title: baseParse.data.title ?? '',
      description: baseParse.data.description ?? null,
    })
  }
  organicHits.sort((a, b) => a.rank - b.rank)

  let clientPosition: number | null = null
  if (clientDomain) {
    const norm = normalizeDomain(clientDomain)
    const hit = organicHits.find((h) => normalizeDomain(h.domain).includes(norm))
    clientPosition = hit?.rank ?? null
  }

  return {
    keyword,
    language,
    hasAIOverview: itemTypes.includes('ai_overview'),
    hasFeaturedSnippet: itemTypes.includes('featured_snippet'),
    hasPeopleAlsoAsk: itemTypes.includes('people_also_ask'),
    itemTypes,
    topOrganic: organicHits.slice(0, 10),
    clientPosition,
    resultPageUrl: result?.check_url ?? null,
    costUsd: typeof task.cost === 'number' ? task.cost : null,
  }
}

/**
 * Trasforma una risposta `serp/google/ai_mode/live/advanced` in
 * `AIOverviewMention`. Restituisce null se l'endpoint non ha trovato un
 * AI Overview per la keyword (caso comune: keyword troppo specifiche).
 */
export function adaptAIOverview(
  rawEnvelope: unknown,
): AIOverviewMention | null {
  const parsed = SerpEnvelopeSchema.safeParse(rawEnvelope)
  if (!parsed.success || !parsed.data.tasks?.length) return null

  const task = parsed.data.tasks[0]
  const result = task.result?.[0]
  if (!result) return null

  const items = (result.items ?? []) as Array<Record<string, unknown>>
  const aiOverview = items.find((it) => it.type === 'ai_overview' || it.type === 'ai_mode_response')
  if (!aiOverview) return null

  // Estrai testo (i campi cambiano: text, content, parts[].text, ...).
  const text = extractText(aiOverview)

  // Estrai domini citati dalle fonti.
  const sourceDomains = extractSourceDomains(aiOverview)

  return {
    keyword: result.keyword ?? '',
    text,
    sourceDomains,
  }
}

// -------------------------------------------------------------------------
// helpers private
// -------------------------------------------------------------------------

function emptySerpScanResult(keyword: string, language: string | null): SerpScanResult {
  return {
    keyword,
    language,
    hasAIOverview: false,
    hasFeaturedSnippet: false,
    hasPeopleAlsoAsk: false,
    itemTypes: [],
    topOrganic: [],
    clientPosition: null,
    resultPageUrl: null,
    costUsd: null,
  }
}

function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
}

function extractText(item: Record<string, unknown>): string | null {
  // Prova diversi field name che DataForSEO ha usato in versioni successive.
  const candidates = ['text', 'content', 'description', 'snippet']
  for (const k of candidates) {
    const v = item[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  // parts[]: array di blocchi { text, type } da concatenare.
  const parts = item.parts
  if (Array.isArray(parts)) {
    const joined = parts
      .map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text?: unknown }).text ?? '') : ''))
      .filter((s) => s.length > 0)
      .join(' ')
      .trim()
    if (joined) return joined
  }
  return null
}

function extractSourceDomains(item: Record<string, unknown>): string[] {
  const sources = new Set<string>()
  // references[]: array di { source, url, title, ... }
  const references = item.references
  if (Array.isArray(references)) {
    for (const ref of references) {
      if (ref && typeof ref === 'object') {
        const r = ref as Record<string, unknown>
        const url = typeof r.url === 'string' ? r.url : null
        const source = typeof r.source === 'string' ? r.source : null
        const candidate = url ?? source
        if (candidate) sources.add(normalizeDomain(candidate))
      }
    }
  }
  // links[]: array alternativo
  const links = item.links
  if (Array.isArray(links)) {
    for (const l of links) {
      if (l && typeof l === 'object') {
        const url = typeof (l as Record<string, unknown>).url === 'string'
          ? ((l as Record<string, unknown>).url as string)
          : null
        if (url) sources.add(normalizeDomain(url))
      }
    }
  }
  return Array.from(sources).filter(Boolean)
}
