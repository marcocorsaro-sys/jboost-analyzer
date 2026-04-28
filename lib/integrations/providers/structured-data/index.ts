/**
 * Structured Data Audit — entrypoint del provider.
 *
 * Riusa il `WappalyzerClient` per il fetch HTML (è già un wrapper di
 * BaseProviderClient con log/timeout/retry/UA appropriato e cap a 1MB).
 * Niente dipendenze nuove. Niente costo monetario.
 *
 * Helper di alto livello: `auditStructuredData(supabase, urls)` analizza
 * 1..N URL e restituisce un summary aggregato con:
 *   - tipi Schema.org per pagina
 *   - presenza dei tipi a valore SEO alto (FAQ, HowTo, Article, ecc.)
 *   - coverage score 0..100 cross-page
 *   - errori di parsing JSON-LD
 *
 * Use case: alimenta una nuova sezione del report Pre-Sales Health Check
 * "Structured Data" e in futuro può feedare un nuovo driver "Schema Coverage"
 * o arricchire il driver "Compliance" attuale.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { WappalyzerClient } from '@/lib/integrations/providers/wappalyzer/client'
import {
  buildPageReport,
  computeSchemaCoverageScore,
  type StructuredDataPageReport,
  type SchemaCoverageScore,
} from './parser'

export {
  parseJsonLdBlocks,
  buildPageReport,
  computeSchemaCoverageScore,
} from './parser'
export type {
  JsonLdBlock,
  StructuredDataPageReport,
  SchemaCoverageScore,
} from './parser'

export interface AuditStructuredDataArgs {
  supabase: SupabaseClient
  /** URL completi (con http(s)://) da scansionare. */
  urls: string[]
  clientId?: string
  analysisId?: string
  userId?: string
}

export interface StructuredDataAuditSummary {
  pages: StructuredDataPageReport[]
  /** Numero di pagine in cui sono stati trovati blocchi JSON-LD validi. */
  pagesWithSchema: number
  /** Numero totale di blocchi JSON-LD trovati cross-page (parsed o no). */
  totalBlocks: number
  /** Numero totale di blocchi con errore di parsing. */
  totalParseErrors: number
  /** Set ordinato di tutti i @type trovati cross-page. */
  uniqueTypes: string[]
  /** Tipi cross-page → numero di pagine in cui appaiono. */
  typeCounts: Record<string, number>
  /** Score 0..100 calcolato sulla copertura cross-page. */
  coverage: SchemaCoverageScore
}

export async function auditStructuredData(
  args: AuditStructuredDataArgs,
): Promise<StructuredDataAuditSummary> {
  if (!args.urls.length) {
    return emptySummary()
  }

  const client = new WappalyzerClient({
    supabase: args.supabase,
    clientId: args.clientId,
    analysisId: args.analysisId,
    userId: args.userId,
  })

  const pages: StructuredDataPageReport[] = []
  // Fetch sequenziale (cap a 10 URL tipico, niente bisogno di concurrency
  // aggressiva qui — Schema.org coverage è "rappresentativo" non "esaustivo").
  for (const url of args.urls) {
    const fetched = await client.fetchPage(url)
    if (!fetched.ok || !fetched.data) {
      pages.push({ url, blocks: [], typesPresent: [], parseErrors: 0 })
      continue
    }
    pages.push(buildPageReport(fetched.data.finalUrl, fetched.data.html))
  }

  const allTypes = new Set<string>()
  const typeCounts: Record<string, number> = {}
  let totalBlocks = 0
  let totalParseErrors = 0
  let pagesWithSchema = 0

  for (const p of pages) {
    if (p.typesPresent.length > 0) pagesWithSchema++
    totalBlocks += p.blocks.length
    totalParseErrors += p.parseErrors
    for (const t of p.typesPresent) {
      allTypes.add(t)
      typeCounts[t] = (typeCounts[t] ?? 0) + 1
    }
  }

  const coverage = computeSchemaCoverageScore(Array.from(allTypes))

  return {
    pages,
    pagesWithSchema,
    totalBlocks,
    totalParseErrors,
    uniqueTypes: Array.from(allTypes).sort(),
    typeCounts,
    coverage,
  }
}

function emptySummary(): StructuredDataAuditSummary {
  return {
    pages: [],
    pagesWithSchema: 0,
    totalBlocks: 0,
    totalParseErrors: 0,
    uniqueTypes: [],
    typeCounts: {},
    coverage: { score: 0, presentTypes: [], missingHighValueTypes: [] },
  }
}
