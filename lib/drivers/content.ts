import { clampScore, type DriverResult } from './utils'

/**
 * Content Driver — versione "combined": aggrega 3 sorgenti di segnale,
 * media tra quelle disponibili. Allineato al `calcContent` locale di
 * run-analysis.ts per evitare regressioni quando una delle sorgenti è
 * in mock fallback.
 *
 * Sorgenti aggregate:
 *  1. PSI Lighthouse Best Practices — segnale tecnico generico
 *  2. SEMrush Site Audit issues + pages_crawled — decay esponenziale
 *     sul tasso di pagine in errore
 *  3. SEMrush organic keywords count — log-scale, segnale di volume di
 *     contenuto indicizzato
 *
 * Score finale = media aritmetica delle sorgenti disponibili.
 * Status ok se ≥1 segnale, no_results se zero.
 */
export function calculateContent(
  siteHealthData: Record<string, unknown> | null,
  psiData: Record<string, unknown> | null = null,
  domainRankData: Record<string, unknown> | null = null,
): DriverResult {
  const signals: number[] = []
  const details: Record<string, unknown> = {}

  // Segnale 1: Lighthouse Best Practices score.
  if (psiData) {
    const bp = Number(psiData.best_practices_score ?? 0)
    if (bp > 0) {
      signals.push(bp)
      details.best_practices_score = bp
    }
  }

  // Segnale 2: SEMrush Site Audit error ratio (decay esponenziale).
  if (siteHealthData) {
    const issues = (siteHealthData.issues as Array<{ type: string; pages_count: number }> | undefined) ?? []
    const pagesCrawled = Number((siteHealthData.pages_crawled as number | undefined) ?? 0)
    if (pagesCrawled > 0) {
      const errorPages = issues
        .filter(i => i.type === 'error' || (i.type as string) === 'critical')
        .reduce((s, i) => s + Number(i.pages_count || 0), 0)
      const ratio = errorPages / pagesCrawled
      const errorScore = Math.max(1, 100 * Math.exp(-ratio * 1.0))
      signals.push(errorScore)
      details.errorPages = errorPages
      details.pagesCrawled = pagesCrawled
      details.errorRatio = Math.round(ratio * 1000) / 1000
    }
  }

  // Segnale 3: SEMrush organic keywords volume (log-scale).
  if (domainRankData) {
    const kw = Number((domainRankData.organicKeywords as number | undefined) ?? (domainRankData.Or as number | undefined) ?? 0)
    if (kw > 0) {
      const kwScore = Math.min(100, Math.log10(kw) * 20)
      signals.push(kwScore)
      details.organicKeywords = kw
      details.keywordsScore = Math.round(kwScore)
    }
  }

  if (signals.length === 0) {
    return { score: null, status: 'no_results' }
  }

  const avg = signals.reduce((a, b) => a + b, 0) / signals.length
  const score = clampScore(avg)
  details.source = 'combined'
  details.signalCount = signals.length

  return score !== null
    ? { score, status: 'ok', details }
    : { score: null, status: 'no_results' }
}
