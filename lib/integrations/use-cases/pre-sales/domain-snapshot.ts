/**
 * Pre-Sales Domain Snapshot — il primo grande use case della Phase 7B.
 *
 * Orchestra tutti i provider esterni che compongono la "miglior fotografia
 * possibile dall'esterno" del dominio di un prospect/cliente:
 *
 *   - DataForSEO        — AI Overview / Featured Snippet / PAA su top keyword
 *   - Wappalyzer OSS    — MarTech stack rilevato dall'HTML
 *   - Structured Data   — Schema.org coverage cross-page
 *   - Indexability      — robots.txt + sitemap + meta robots + canonical + hreflang
 *   - CrUX              — Core Web Vitals reali (RUM data 28gg)
 *   - WHOIS             — domain age + expiration + registrar
 *
 * Tutto in parallelo con `Promise.allSettled` + deadline globale + partial
 * result tolerance: se un provider è giù, gli altri continuano e il
 * risultato torna comunque, marcando i pezzi mancanti.
 *
 * L'output `DomainSnapshot` è il payload che alimenta:
 *   - il PDF report "Pre-Sales Health Check"
 *   - una nuova pagina UI `/pre-sales/snapshot/[domain]` (futura)
 *   - eventuale memorizzazione su DB per drift detection nel tempo
 *
 * Costo a regime (Deep, 100 keyword DataForSEO): ~$1.55-1.60 per snapshot.
 * Tempo: 20-40 secondi con concurrency parallela.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { ScanAIOverviewSummary } from '@/lib/integrations/providers/dataforseo'
import type { TechStackResult } from '@/lib/integrations/providers/wappalyzer'
import type { StructuredDataAuditSummary } from '@/lib/integrations/providers/structured-data'
import type { IndexabilityAuditSummary } from '@/lib/integrations/providers/indexability'
import type { CruxSummary } from '@/lib/integrations/providers/crux'
import type { WhoisSummary } from '@/lib/integrations/providers/whois'

export interface DomainSnapshotArgs {
  supabase: SupabaseClient
  /** Dominio del prospect/cliente (con o senza http(s)://). */
  domain: string
  /** Country target per le query SERP (es. 'Italy'). */
  country?: string
  /** Lingua ISO (es. 'it'). */
  language?: string
  /** Top keyword del cliente per la scansione AI Overview. Se vuote o assenti,
   *  la sezione DataForSEO viene skippata. */
  keywords?: string[]
  /** URL aggiuntivi da scansionare per Structured Data (oltre alla home). */
  extraStructuredDataUrls?: string[]
  /** Optional client_id / analysis_id / user_id per propagare nel call log. */
  clientId?: string
  analysisId?: string
  userId?: string
  /** Deadline globale in ms. Default: 60_000 (1 min). */
  deadlineMs?: number
}

export interface DomainSnapshot {
  domain: string
  startedAt: string
  completedAt: string
  elapsedMs: number
  /** Provider che hanno fallito o non avevano dati sufficienti. */
  errors: Array<{ provider: string; message: string }>
  /** Score sintetico 0..100 cross-provider per il pre-sales. */
  presalesScore: number | null
  // Per-provider results (null se skipped/fallito)
  ai: ScanAIOverviewSummary | null
  tech: TechStackResult | null
  structuredData: StructuredDataAuditSummary | null
  indexability: IndexabilityAuditSummary | null
  crux: CruxSummary | null
  whois: WhoisSummary | null
}

export async function buildDomainSnapshot(args: DomainSnapshotArgs): Promise<DomainSnapshot> {
  const startedAt = new Date()
  const errors: Array<{ provider: string; message: string }> = []
  const deadlineMs = args.deadlineMs ?? 60_000
  const baseUrl = args.domain.startsWith('http') ? args.domain : `https://${args.domain}`

  // Importi dynamic per (a) tenere fuori dal cold-start bundle i provider
  // pesanti quando il use case non è chiamato, (b) evitare circular import.
  const [{ scanAIOverviewVisibility }, { detectTechStack }, { auditStructuredData }, { auditIndexability }, { fetchCruxSummary }, { fetchWhoisSummary }] =
    await Promise.all([
      import('@/lib/integrations/providers/dataforseo'),
      import('@/lib/integrations/providers/wappalyzer'),
      import('@/lib/integrations/providers/structured-data'),
      import('@/lib/integrations/providers/indexability'),
      import('@/lib/integrations/providers/crux'),
      import('@/lib/integrations/providers/whois'),
    ])

  // Helper: bloccato a deadline
  const withDeadline = <T,>(p: Promise<T>): Promise<T | { __timeout: true }> =>
    Promise.race([
      p,
      new Promise<{ __timeout: true }>((resolve) =>
        setTimeout(() => resolve({ __timeout: true }), deadlineMs),
      ),
    ])

  // Provider commons
  const propagation = {
    supabase: args.supabase,
    clientId: args.clientId,
    analysisId: args.analysisId,
    userId: args.userId,
  }

  // Lancia tutto in parallelo
  const [aiR, techR, sdR, idxR, cruxR, whoisR] = await Promise.allSettled([
    args.keywords && args.keywords.length > 0
      ? withDeadline(
          scanAIOverviewVisibility({
            ...propagation,
            keywords: args.keywords,
            location: args.country ?? 'Italy',
            language: args.language ?? 'it',
            clientDomain: args.domain,
            concurrency: 5,
          }),
        )
      : Promise.resolve(null as ScanAIOverviewSummary | null),
    withDeadline(detectTechStack({ ...propagation, domain: args.domain })),
    withDeadline(
      auditStructuredData({
        ...propagation,
        urls: [baseUrl, ...(args.extraStructuredDataUrls ?? [])],
      }),
    ),
    withDeadline(auditIndexability({ ...propagation, domain: args.domain })),
    withDeadline(fetchCruxSummary({ ...propagation, domain: args.domain, formFactor: 'PHONE' })),
    withDeadline(fetchWhoisSummary({ ...propagation, domain: args.domain })),
  ])

  // Disambigua risultati
  const ai = pick<ScanAIOverviewSummary>(aiR, 'dataforseo', errors)
  const tech = pick<TechStackResult>(techR, 'wappalyzer', errors)
  const structuredData = pick<StructuredDataAuditSummary>(sdR, 'structured_data', errors)
  const indexability = pick<IndexabilityAuditSummary>(idxR, 'indexability', errors)
  const crux = pick<CruxSummary>(cruxR, 'crux', errors)
  const whois = pick<WhoisSummary>(whoisR, 'whois', errors)

  const completedAt = new Date()
  const elapsedMs = completedAt.getTime() - startedAt.getTime()

  return {
    domain: args.domain,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    elapsedMs,
    errors,
    presalesScore: computePresalesScore({ ai, tech, structuredData, indexability, crux, whois }),
    ai,
    tech,
    structuredData,
    indexability,
    crux,
    whois,
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function pick<T>(
  settled: PromiseSettledResult<T | { __timeout: true } | null>,
  providerName: string,
  errors: Array<{ provider: string; message: string }>,
): T | null {
  if (settled.status === 'rejected') {
    errors.push({
      provider: providerName,
      message: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
    })
    return null
  }
  const v = settled.value
  if (v === null) return null
  if (typeof v === 'object' && v !== null && '__timeout' in v) {
    errors.push({ provider: providerName, message: 'timeout (deadline exceeded)' })
    return null
  }
  return v as T
}

/**
 * Pre-sales score 0..100 sintetizzando i risultati di tutti i provider.
 * Pesi pragmatici, da rivedere in funzione di feedback del business team
 * (Marco/Jakala). I pesi sotto cumulati danno 100 quando un dominio è
 * "perfetto":
 *
 *   - 25 — Indexability (robots/sitemap/canonical/hreflang/meta robots)
 *   - 20 — Structured Data coverage
 *   - 20 — CrUX score (Core Web Vitals)
 *   - 15 — AI Overview percentage (DataForSEO)
 *   - 10 — MarTech maturity (numero categorie distinte)
 *   - 10 — Domain age (>= 5 anni = 100% di questo slot)
 *
 * Quando un provider è null/skipped, il suo slot viene scalato proporzionalmente
 * dal totale. Esempio: se DataForSEO è skipped (no keyword), max diventa 85.
 */
function computePresalesScore(parts: {
  ai: ScanAIOverviewSummary | null
  tech: TechStackResult | null
  structuredData: StructuredDataAuditSummary | null
  indexability: IndexabilityAuditSummary | null
  crux: CruxSummary | null
  whois: WhoisSummary | null
}): number | null {
  let weightedScore = 0
  let weightTotal = 0

  if (parts.indexability) {
    weightedScore += (parts.indexability.score / 100) * 25
    weightTotal += 25
  }
  if (parts.structuredData) {
    weightedScore += (parts.structuredData.coverage.score / 100) * 20
    weightTotal += 20
  }
  if (parts.crux && parts.crux.available && parts.crux.score !== null) {
    weightedScore += (parts.crux.score / 100) * 20
    weightTotal += 20
  }
  if (parts.ai && parts.ai.successCount > 0) {
    // AI presence: quanto più presence, meglio è — ma è atteso che siano
    // numeri bassi (10-30%). Mappiamo 0->0, 25%->100, 50%+->100.
    const aiNorm = Math.min(100, parts.ai.aiOverviewPercentage * 4)
    weightedScore += (aiNorm / 100) * 15
    weightTotal += 15
  }
  if (parts.tech) {
    // MarTech maturity: numero di categorie distinte. 0->0, 8+->100.
    const cats = Object.keys(parts.tech.byCategory).length
    const maturity = Math.min(100, (cats / 8) * 100)
    weightedScore += (maturity / 100) * 10
    weightTotal += 10
  }
  if (parts.whois && parts.whois.ageYears !== null) {
    // Domain age: 0y->0, 5y+->100
    const ageNorm = Math.min(100, (parts.whois.ageYears / 5) * 100)
    weightedScore += (ageNorm / 100) * 10
    weightTotal += 10
  }

  if (weightTotal === 0) return null
  return Math.round((weightedScore / weightTotal) * 100)
}
