import { clampScore, type DriverResult } from './utils'

/**
 * Awareness Driver
 * Source: SEMrush domain_rank_history (mapped as trends_brand_awareness)
 * Formula:
 *   If latestRank > 0: score = 100 - min(90, log10(latestRank) × 20)
 *   Else if traffic available: score = min(100, log10(traffic) × 10)
 *   Mock data (_meta.is_mock): returns { score: 0, noResults: true }
 */
export function calculateAwareness(trendsData: Record<string, unknown> | null): DriverResult {
  if (!trendsData) {
    return { score: null, status: 'no_results' }
  }

  // Check for mock data
  const meta = trendsData._meta as Record<string, unknown> | undefined
  if (meta?.is_mock === true) {
    return { score: 0, status: 'no_results', details: { noResults: true } }
  }

  const latestRank = Number(trendsData.latestRank || 0)
  const average = Number(trendsData.average || 0)
  const latest = Number(trendsData.latest || 0)

  let score: number | null = null

  if (latestRank > 0) {
    score = Math.round(100 - Math.min(90, Math.log10(latestRank) * 20))
  } else {
    const traffic = average || latest
    if (traffic > 0) {
      score = Math.round(Math.min(100, Math.log10(traffic) * 10))
    }
  }

  const clamped = clampScore(score)

  return {
    score: clamped,
    status: clamped !== null ? 'ok' : 'no_results',
    details: {
      latestRank,
      average,
      latest,
      source: 'semrush_brand_awareness',
    },
  }
}
