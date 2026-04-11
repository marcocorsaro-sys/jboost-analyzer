import { clampScore, normalizeSemrushRow, type DriverResult } from './utils'

/**
 * ASO Visibility Driver
 * Source: SEMrush domain_rank — adwords metrics
 * Formula:
 *   If adwords data available:
 *     kw_part = (log10(adwordsKeywords) / 5) × 100
 *     traffic_part = (log10(adwordsTraffic) / 7) × 100
 *     score = average of available parts
 *   Else if rank available (reduced fallback):
 *     score = (100 - min(90, log10(rank) × 20)) × 0.6
 */
export function calculateAsoVisibility(domainRankData: Record<string, unknown> | null): DriverResult {
  const norm = normalizeSemrushRow(domainRankData)

  if (!norm) {
    return { score: null, status: 'no_results' }
  }

  let score: number | null = null

  if (norm.adwordsKeywords > 0 || norm.adwordsTraffic > 0) {
    const parts: number[] = []

    if (norm.adwordsKeywords > 0) {
      parts.push((Math.log10(norm.adwordsKeywords) / 5) * 100)
    }
    if (norm.adwordsTraffic > 0) {
      parts.push((Math.log10(norm.adwordsTraffic) / 7) * 100)
    }

    if (parts.length > 0) {
      score = parts.reduce((a, b) => a + b, 0) / parts.length
    }
  } else if (norm.rank > 0) {
    // Fallback: rank-based with 0.6 multiplier (indirect indicator)
    score = (100 - Math.min(90, Math.log10(norm.rank) * 20)) * 0.6
  }

  const clamped = clampScore(score)

  return {
    score: clamped,
    status: clamped !== null ? 'ok' : 'no_results',
    details: {
      adwordsKeywords: norm.adwordsKeywords,
      adwordsTraffic: norm.adwordsTraffic,
      rank: norm.rank,
      source: 'semrush_domain_rank',
    },
  }
}
