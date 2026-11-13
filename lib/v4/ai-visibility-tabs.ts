/**
 * V4 — AI Visibility detail tabs (Sentiment · Citation rate & sources · Market share).
 *
 * Same paste-driven loop as the AI Visibility score (there is no API): per tab
 * the app shows a copyable prompt (default below, editable by the analyst),
 * the analyst runs it in J-Horizon (or any AI engine) and pastes/uploads the
 * answer, and ONE LLM call reads it into the tab's structured shape.
 *
 * Hard rules, all enforced here and not left to the model:
 *   - nothing is invented: a figure the answer does not state is null, and every
 *     null is reported in `missing` so the UI can SHOW the gap;
 *   - sources are only the ones literally present in the pasted answer: a
 *     source whose domain does not appear in the text is dropped and flagged;
 *   - percentages outside 0-100 are an extraction error, never clamped;
 *   - these tabs never touch the driver score (the GEO score keeps its own flow).
 *
 * Pure: no I/O. The route supplies the sites and calls the model.
 */

import type { AnalysisSite } from '@/lib/v4/runner/types'

export const AI_TAB_KEYS = ['sentiment', 'citations', 'market_share'] as const
export type AiTabKey = (typeof AI_TAB_KEYS)[number]

export function isAiTabKey(v: unknown): v is AiTabKey {
  return typeof v === 'string' && (AI_TAB_KEYS as readonly string[]).includes(v)
}

export const AI_TAB_LABELS: Record<AiTabKey, string> = {
  sentiment: 'Sentiment',
  citations: 'Citation rate & fonti',
  market_share: 'Market share',
}

function roster(sites: AnalysisSite[]): string[] {
  return sites.map((s) => {
    const brand = s.brand_name?.trim() || s.name
    return `- ${s.is_client ? 'Cliente' : s.name}: ${brand} (${s.domain})`
  })
}

/** Pure: the default, editable prompt the analyst copies for one tab. */
export function defaultTabPrompt(tab: AiTabKey, sites: AnalysisSite[]): string {
  const head = ['Analizza i seguenti brand nelle risposte dei motori AI (ChatGPT, Perplexity, Gemini, ecc.):', ...roster(sites), '']
  const tail = ['', 'Se non hai dati su un brand o su un valore, dichiaralo esplicitamente invece di stimare.']

  if (tab === 'sentiment') {
    return [
      ...head,
      'Per OGNI brand riporta:',
      '1. il dominio;',
      '2. la ripartizione del sentiment delle menzioni (% positivo, % neutro, % negativo);',
      '3. i temi ricorrenti che motivano il sentiment (elenco breve).',
      ...tail,
    ].join('\n')
  }
  if (tab === 'citations') {
    return [
      ...head,
      'Per OGNI brand riporta:',
      '1. il dominio;',
      '2. il citation rate (% di risposte in cui il brand/dominio è citato);',
      '3. le fonti effettivamente citate nelle risposte (dominio della fonte e, se disponibile, numero di citazioni).',
      'Elenca SOLO fonti realmente presenti nelle risposte analizzate, senza completarle.',
      ...tail,
    ].join('\n')
  }
  return [
    ...head,
    'Per OGNI brand riporta:',
    '1. il dominio;',
    '2. la market share (share of voice, % sul totale delle menzioni dei brand elencati).',
    ...tail,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Extraction shapes
// ---------------------------------------------------------------------------

export interface SentimentSite {
  site_ref: string
  positive_pct: number | null
  neutral_pct: number | null
  negative_pct: number | null
  themes: string[]
}
export interface CitationSource {
  domain: string
  count: number | null
}
export interface CitationSite {
  site_ref: string
  citation_rate_pct: number | null
  sources: CitationSource[]
}
export interface MarketShareSite {
  site_ref: string
  share_pct: number | null
}

export type TabSites = SentimentSite[] | CitationSite[] | MarketShareSite[]

export interface MissingItem {
  site_ref: string
  field: string
}

export interface TabExtraction {
  tab: AiTabKey
  sites: TabSites
  /** Every field the answer did not provide (null), so the UI evidences the gap. */
  missing: MissingItem[]
  /** Non-blocking notes: dropped sources, shares not summing to ~100, … */
  warnings: string[]
  /** Short free-text reading grounded in the answer (Italian), may be empty. */
  summary: string
}

const FIELDS: Record<AiTabKey, { numeric: string[]; extra: string[] }> = {
  sentiment: { numeric: ['positive_pct', 'neutral_pct', 'negative_pct'], extra: ['themes'] },
  citations: { numeric: ['citation_rate_pct'], extra: ['sources'] },
  market_share: { numeric: ['share_pct'], extra: [] },
}

/** Pure: the extraction prompt sent to the model with the pasted answer. */
export function buildTabExtractionPrompt(tab: AiTabKey, pasted: string, sites: AnalysisSite[]): string {
  const siteRoster = sites.map((s) => ({
    site_ref: s.site_ref,
    domain: s.domain,
    brand: s.brand_name?.trim() || s.name,
  }))
  const shape: Record<AiTabKey, string> = {
    sentiment:
      '{"sites":[{"site_ref":string,"positive_pct":number|null,"neutral_pct":number|null,"negative_pct":number|null,"themes":string[]}],"summary":string}',
    citations:
      '{"sites":[{"site_ref":string,"citation_rate_pct":number|null,"sources":[{"domain":string,"count":number|null}]}],"summary":string}',
    market_share: '{"sites":[{"site_ref":string,"share_pct":number|null}],"summary":string}',
  }
  return [
    `You are extracting the "${AI_TAB_LABELS[tab]}" data of an AI-visibility analysis from a pasted answer.`,
    'Sites to look for (match by domain or brand name):',
    JSON.stringify(siteRoster),
    '',
    'Pasted answer:',
    '"""',
    pasted,
    '"""',
    '',
    'Return ONLY a JSON object, no prose, no code fences, with this exact shape:',
    shape[tab],
    '',
    'Rules:',
    '- one entry per site in the roster, using its site_ref;',
    '- every number is a percentage 0-100 exactly as the answer states it;',
    '- a value the answer does not state MUST be null. NEVER invent, estimate or infer a figure;',
    tab === 'citations'
      ? '- sources: ONLY domains literally written in the answer; if the answer lists none, use an empty array;'
      : '- themes: short phrases taken from the answer, empty array when none;',
    '- summary: Italian, 200-400 characters, grounded only in the answer, no em-dash characters.',
  ].join('\n')
}

function pct(v: unknown, label: string): { value: number | null; error: string | null } {
  if (v === null || v === undefined) return { value: null, error: null }
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { value: null, error: `${label} non valido: ${String(v)} (atteso 0-100)` }
  }
  return { value: n, error: null }
}

const norm = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim()

/**
 * Pure: validate the model's JSON for one tab against the site set and the
 * pasted text. Returns an error (not a throw) when the output is unusable.
 */
export function parseTabExtraction(
  tab: AiTabKey,
  modelText: string,
  sites: AnalysisSite[],
  pasted: string,
): { extraction: TabExtraction | null; error: string | null } {
  const start = modelText.indexOf('{')
  const end = modelText.lastIndexOf('}')
  if (start < 0 || end <= start) return { extraction: null, error: 'estrazione: la risposta del modello non contiene JSON' }

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(modelText.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return { extraction: null, error: 'estrazione: JSON non valido nella risposta del modello' }
  }
  if (!Array.isArray(obj.sites)) return { extraction: null, error: 'estrazione: manca l\'array "sites"' }

  const entries = new Map<string, Record<string, unknown>>()
  for (const e of obj.sites as Array<Record<string, unknown>>) {
    const ref = String(e?.site_ref ?? '')
    if (sites.some((s) => s.site_ref === ref) && !entries.has(ref)) entries.set(ref, e)
  }

  const warnings: string[] = []
  const lowerPasted = pasted.toLowerCase()
  const out: Array<Record<string, unknown>> = []
  const missing: MissingItem[] = []

  for (const site of sites) {
    const e = entries.get(site.site_ref) ?? {}
    const row: Record<string, unknown> = { site_ref: site.site_ref }

    for (const field of FIELDS[tab].numeric) {
      const r = pct(e[field], `${field} per ${site.site_ref}`)
      if (r.error) return { extraction: null, error: `estrazione: ${r.error}` }
      row[field] = r.value
      if (r.value === null) missing.push({ site_ref: site.site_ref, field })
    }

    if (tab === 'sentiment') {
      const themes = Array.isArray(e.themes)
        ? (e.themes as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 8)
        : []
      row.themes = themes
      if (themes.length === 0) missing.push({ site_ref: site.site_ref, field: 'themes' })
      const parts = ['positive_pct', 'neutral_pct', 'negative_pct'].map((f) => row[f] as number | null)
      if (parts.every((p) => p !== null)) {
        const total = (parts as number[]).reduce((a, b) => a + b, 0)
        if (Math.abs(total - 100) > 5) warnings.push(`${site.site_ref}: le quote di sentiment sommano ${Math.round(total)}%, non 100%`)
      }
    }

    if (tab === 'citations') {
      const sources: CitationSource[] = []
      const seen = new Set<string>()
      for (const s of Array.isArray(e.sources) ? (e.sources as Array<Record<string, unknown>>) : []) {
        const domain = typeof s?.domain === 'string' ? norm(s.domain) : ''
        if (!domain || seen.has(domain)) continue
        // Only sources literally present in the pasted answer survive.
        if (!lowerPasted.includes(domain)) {
          warnings.push(`${site.site_ref}: fonte "${domain}" scartata, non compare nella risposta incollata`)
          continue
        }
        seen.add(domain)
        const c = s.count === null || s.count === undefined ? null : Number(s.count)
        sources.push({ domain, count: c !== null && Number.isFinite(c) && c >= 0 ? c : null })
      }
      row.sources = sources
      if (sources.length === 0) missing.push({ site_ref: site.site_ref, field: 'sources' })
    }

    out.push(row)
  }

  if (tab === 'market_share') {
    const shares = out.map((r) => r.share_pct as number | null).filter((x): x is number => x !== null)
    const total = shares.reduce((a, b) => a + b, 0)
    if (shares.length === sites.length && Math.abs(total - 100) > 5) {
      warnings.push(`le quote sommano ${Math.round(total)}%, non 100%`)
    } else if (total > 105) {
      warnings.push(`le quote sommano ${Math.round(total)}%, oltre 100%`)
    }
  }

  return {
    extraction: {
      tab,
      sites: out as unknown as TabSites,
      missing,
      warnings,
      summary: typeof obj.summary === 'string' ? obj.summary : '',
    },
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Stored state (analyses.v4_setup.ai_visibility_tabs)
// ---------------------------------------------------------------------------

export interface StoredTab {
  /** Analyst-customized prompt; null = use the default. */
  prompt: string | null
  /** The pasted/uploaded answer. */
  answer: string
  extraction: TabExtraction | null
  extraction_error: string | null
  extracted_at: string | null
  model: string | null
  updated_at: string
}
export type StoredTabs = Partial<Record<AiTabKey, StoredTab>>

/** Pure: read the stored tabs defensively (the column is free-form jsonb). */
export function readStoredTabs(v4Setup: Record<string, unknown> | null | undefined): StoredTabs {
  const raw = v4Setup?.ai_visibility_tabs
  if (!raw || typeof raw !== 'object') return {}
  const out: StoredTabs = {}
  for (const key of AI_TAB_KEYS) {
    const t = (raw as Record<string, unknown>)[key]
    if (!t || typeof t !== 'object') continue
    const o = t as Record<string, unknown>
    out[key] = {
      prompt: typeof o.prompt === 'string' && o.prompt.trim() ? o.prompt : null,
      answer: typeof o.answer === 'string' ? o.answer : '',
      extraction: o.extraction && typeof o.extraction === 'object' ? (o.extraction as TabExtraction) : null,
      extraction_error: typeof o.extraction_error === 'string' ? o.extraction_error : null,
      extracted_at: typeof o.extracted_at === 'string' ? o.extracted_at : null,
      model: typeof o.model === 'string' ? o.model : null,
      updated_at: typeof o.updated_at === 'string' ? o.updated_at : '',
    }
  }
  return out
}
