/**
 * DataForSEO — entrypoint del provider per use case JBoost Analyzer.
 *
 * Ri-esporta `DataForSEOClient` (low-level, una funzione = un endpoint) e
 * fornisce **helper di alto livello** che il resto del codebase JBA usa
 * direttamente, senza accoppiarsi alla shape grezza della risposta.
 *
 * Il primo helper di alto livello che esponiamo è `scanAIOverviewVisibility`:
 * data una lista di keyword (tipicamente le top organiche del cliente
 * estratte da SEMrush/Ahrefs), per ognuna fa una SERP query e calcola
 * un riassunto della "visibilità AI" del cliente, utile per:
 *
 *   - alimentare il driver `AI Relevance` del framework 9-driver in modo
 *     più preciso di quanto fa oggi Ahrefs (che marca "ai_overview" su
 *     campioni piccoli e talvolta stale)
 *   - generare la sezione "AI Visibility" del report Pre-Sales Health Check
 *
 * Costo stimato: ~$0.0006 per keyword, quindi 100 keyword = $0.06.
 * Concurrency cap a 5 chiamate parallele per non saturare il rate limit.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  DataForSEOClient,
  readDataForSEOCredentialsFromEnv,
  type DataForSEOCredentials,
} from './client'
import {
  adaptSerpOrganic,
  type SerpScanResult,
} from './adapters'

export {
  DataForSEOClient,
  readDataForSEOCredentialsFromEnv,
} from './client'
export type {
  DataForSEOCredentials,
  DataForSEOEnvelope,
  DataForSEOClientOptions,
} from './client'
export {
  adaptSerpOrganic,
  adaptAIOverview,
} from './adapters'
export type {
  SerpScanResult,
  SerpOrganicHit,
  AIOverviewMention,
} from './adapters'

// =========================================================================
// scanAIOverviewVisibility — high-level helper
// =========================================================================

export interface ScanAIOverviewArgs {
  /** Service-role Supabase client (per logging in integration_call_log). */
  supabase: SupabaseClient
  /** Keywords da scansionare (es. top 50 organic keyword del cliente). */
  keywords: string[]
  /** Country target (es. 'Italy', 'United States'). DataForSEO usa nomi puri. */
  location: string
  /** ISO 639-1 code della lingua (es. 'it', 'en'). */
  language?: string
  /** Dominio del cliente per cui calcolare la posizione su ogni SERP. */
  clientDomain?: string
  /** Optional client_id / analysis_id per propagare nel call log. */
  clientId?: string
  analysisId?: string
  userId?: string
  /** Concurrency cap per le chiamate SERP. Default 5. */
  concurrency?: number
  /** Override credenziali (altrimenti vengono lette da env). */
  credentials?: DataForSEOCredentials
}

export interface ScanAIOverviewSummary {
  totalKeywords: number
  successCount: number
  errorCount: number
  /** Numero di keyword con AI Overview presente nella SERP. */
  aiOverviewCount: number
  /** Numero di keyword con Featured Snippet. */
  featuredSnippetCount: number
  /** Numero di keyword con People Also Ask. */
  peopleAlsoAskCount: number
  /** Percentuale (0-100) di keyword con almeno una feature SERP "rich". */
  richSerpPercentage: number
  /** Percentuale (0-100) specifica per AI Overview. È quello che alimenta
   *  il driver `AI Relevance` del framework 9-driver. */
  aiOverviewPercentage: number
  /** Keyword in cui il cliente è in top 10 (se clientDomain passato). */
  clientTop10Count: number
  /** Costo totale della scansione in USD. */
  totalCostUsd: number
  /** Risultati per-keyword, max 200 in memoria. */
  perKeyword: SerpScanResult[]
}

export async function scanAIOverviewVisibility(
  args: ScanAIOverviewArgs,
): Promise<ScanAIOverviewSummary> {
  if (!args.keywords.length) {
    return {
      totalKeywords: 0,
      successCount: 0,
      errorCount: 0,
      aiOverviewCount: 0,
      featuredSnippetCount: 0,
      peopleAlsoAskCount: 0,
      richSerpPercentage: 0,
      aiOverviewPercentage: 0,
      clientTop10Count: 0,
      totalCostUsd: 0,
      perKeyword: [],
    }
  }

  const client = new DataForSEOClient({
    supabase: args.supabase,
    clientId: args.clientId,
    analysisId: args.analysisId,
    userId: args.userId,
    credentials: args.credentials,
  })

  const concurrency = Math.max(1, Math.min(args.concurrency ?? 5, 20))
  const queue = [...args.keywords]
  const results: SerpScanResult[] = []
  let errorCount = 0
  let totalCostUsd = 0

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const keyword = queue.shift()
      if (keyword === undefined) return
      const res = await client.serpGoogleOrganic({
        keyword,
        location: args.location,
        language: args.language ?? 'it',
      })
      if (!res.ok || !res.data) {
        errorCount++
        // eslint-disable-next-line no-console
        console.warn(
          `[dataforseo] serpGoogleOrganic failed for "${keyword}": ${res.error ?? `HTTP ${res.status}`}`,
        )
        continue
      }
      const adapted = adaptSerpOrganic(res.data, args.clientDomain)
      results.push(adapted)
      if (adapted.costUsd) totalCostUsd += adapted.costUsd
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)

  const successCount = results.length
  const aiOverviewCount = results.filter((r) => r.hasAIOverview).length
  const featuredSnippetCount = results.filter((r) => r.hasFeaturedSnippet).length
  const peopleAlsoAskCount = results.filter((r) => r.hasPeopleAlsoAsk).length
  const richCount = results.filter(
    (r) => r.hasAIOverview || r.hasFeaturedSnippet || r.hasPeopleAlsoAsk,
  ).length
  const clientTop10Count = results.filter(
    (r) => typeof r.clientPosition === 'number' && r.clientPosition <= 10,
  ).length

  return {
    totalKeywords: args.keywords.length,
    successCount,
    errorCount,
    aiOverviewCount,
    featuredSnippetCount,
    peopleAlsoAskCount,
    richSerpPercentage: successCount === 0 ? 0 : Math.round((richCount / successCount) * 1000) / 10,
    aiOverviewPercentage:
      successCount === 0 ? 0 : Math.round((aiOverviewCount / successCount) * 1000) / 10,
    clientTop10Count,
    totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
    // cap a 200 per non gonfiare la response
    perKeyword: results.slice(0, 200),
  }
}
