/**
 * Wappalyzer-style provider — entrypoint per il use case JBoost.
 *
 * Espone:
 *   - WappalyzerClient   — fetch HTML+headers di una pagina
 *   - detectFromPage     — applica i fingerprints e ritorna la lista tech
 *   - detectTechStack    — high-level: dato un dominio, fa fetch + detect
 *
 * Niente API key esterna. Zero costo monetario per chiamata. L'unica
 * spesa è bandwidth (1MB/cliente) + cpu del matching.
 *
 * Roadmap (futuro):
 *   - Estendere fingerprints da 50 a ~300 (ne mancano: Cloud security,
 *     CRM avanzati, payment processor, ATS, SEO tool client-side)
 *   - Detection multi-pagina: oltre la home, fare fetch di /privacy,
 *     /products, /checkout per cogliere tech specifiche di flow
 *   - Capability detection (es. JS frameworks behind SSR — richiede
 *     di parsare bundle code, costo CPU significativo)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { WappalyzerClient } from './client'
import { detectFromPage, type DetectedTech } from './detector'

export { WappalyzerClient } from './client'
export type { FetchPageResult } from './client'
export { detectFromPage } from './detector'
export type { DetectedTech } from './detector'
export { FINGERPRINTS } from './fingerprints'
export type { Fingerprint, FingerprintCategory } from './fingerprints'

export interface DetectTechStackArgs {
  supabase: SupabaseClient
  /** Dominio del cliente (con o senza http://). */
  domain: string
  /** Optional client_id / analysis_id per propagare nel call log. */
  clientId?: string
  analysisId?: string
  userId?: string
}

export interface TechStackResult {
  ok: boolean
  /** URL effettivo dopo redirect. null se fetch fallito. */
  finalUrl: string | null
  /** HTTP status del fetch della home. */
  status: number
  /** Tecnologie rilevate, ordinate per categoria + confidence. */
  technologies: DetectedTech[]
  /** Conteggio tech per categoria (utile per il report). */
  byCategory: Record<string, number>
  /** Errore stringa se ok=false. */
  error?: string
}

export async function detectTechStack(
  args: DetectTechStackArgs,
): Promise<TechStackResult> {
  const client = new WappalyzerClient({
    supabase: args.supabase,
    clientId: args.clientId,
    analysisId: args.analysisId,
    userId: args.userId,
  })

  const fetched = await client.fetchPage(args.domain)
  if (!fetched.ok || !fetched.data) {
    return {
      ok: false,
      finalUrl: null,
      status: fetched.status,
      technologies: [],
      byCategory: {},
      error: fetched.error,
    }
  }

  const technologies = detectFromPage(fetched.data)
  const byCategory: Record<string, number> = {}
  for (const t of technologies) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1
  }

  return {
    ok: true,
    finalUrl: fetched.data.finalUrl,
    status: fetched.status,
    technologies,
    byCategory,
  }
}
