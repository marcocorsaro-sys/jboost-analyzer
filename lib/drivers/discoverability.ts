import { clampScore, normalizeSemrushRow, type DriverResult } from './utils'

/**
 * Discoverability Driver
 * Source: SEMrush domain_rank (Rk, Ot, Or)
 * Formula:
 *   If rank > 0: score = 100 - min(90, log10(rank) × 20)
 *   Else: average of traffic_part and keywords_part (log scale)
 */
export function calculateDiscoverability(domainRankData: Record<string, unknown> | null): DriverResult {
  const norm = normalizeSemrushRow(domainRankData)

  if (!norm) {
    return { score: null, status: 'no_results' }
  }

  let score: number | null = null

  if (norm.rank > 0) {
    // Primary: rank-based scoring (logarithmic)
    score = 100 - Math.min(90, Math.log10(norm.rank) * 20)
  } else {
    // Fallback: average of traffic and keyword metrics
    const parts: number[] = []

    if (norm.organicTraffic > 0) {
      parts.push((Math.log10(norm.organicTraffic) / 8) * 100)
    }
    if (norm.organicKeywords > 0) {
      parts.push((Math.log10(norm.organicKeywords) / 7) * 100)
    }

    if (parts.length > 0) {
      score = parts.reduce((a, b) => a + b, 0) / parts.length
    }
  }

  const clamped = clampScore(score)

  if (clamped === null) {
    return { score: null, status: 'failed' }
  }

  return {
    score: clamped,
    status: 'ok',
    details: {
      rank: norm.rank,
      organicTraffic: norm.organicTraffic,
      organicKeywords: norm.organicKeywords,
      source: 'semrush_domain_rank',
    },
  }
}
