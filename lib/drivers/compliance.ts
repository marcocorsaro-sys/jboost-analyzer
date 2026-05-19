import { clampScore, type DriverResult } from './utils'

/**
 * Compliance Driver — più tollerante della prima versione (allineato al
 * `calcCompliance` locale di run-analysis.ts).
 *
 * Sorgenti, in ordine di preferenza:
 *  1. PSI Lighthouse SEO (mobile) — disponibile per ogni dominio web
 *  2. SEMrush Site Audit `site_health_score` — fallback (richiede un
 *     progetto Site Audit configurato in SEMrush; raro per i prospect)
 *
 * Status:
 *  - ok        : almeno una delle due sorgenti ha restituito uno score
 *  - no_results: entrambe le sorgenti vuote/mock
 */
export function calculateCompliance(
  siteHealthData: Record<string, unknown> | null,
  psiData: Record<string, unknown> | null = null,
): DriverResult {
  // Path A: PSI Lighthouse SEO. Robusto, sempre disponibile se la API key è
  // configurata.
  if (psiData) {
    const seo = Number(psiData.seo_score ?? 0)
    if (seo > 0) {
      const score = clampScore(seo)
      if (score !== null) {
        return {
          score,
          status: 'ok',
          details: {
            source: 'pagespeed_seo',
            seo_score: psiData.seo_score,
          },
        }
      }
    }
  }

  // Path B: SEMrush site_health_score (richiede project audit configurato).
  if (siteHealthData) {
    const sh = Number((siteHealthData.site_health_score as number | undefined) ?? 0)
    if (sh > 0) {
      const score = clampScore(sh)
      if (score !== null) {
        return {
          score,
          status: 'ok',
          details: {
            source: 'semrush_site_health',
            site_health_score: siteHealthData.site_health_score,
          },
        }
      }
    }
  }

  return { score: null, status: 'no_results' }
}
