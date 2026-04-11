import { clampScore, type DriverResult } from './utils'

/**
 * Authority Driver
 * Source: Ahrefs Domain Rating (0-100)
 * Formula: Direct mapping
 */
export function calculateAuthority(ahrefsData: Record<string, unknown> | null): DriverResult {
  if (!ahrefsData) {
    return { score: null, status: 'no_results' }
  }

  const domainRating = ahrefsData.domain_rating as number | undefined

  // If Ahrefs returns 403, use mock with DR=50
  const isMock = (ahrefsData._meta as Record<string, unknown>)?.is_mock === true

  const score = clampScore(domainRating)

  if (score === null) {
    return { score: isMock ? 50 : null, status: isMock ? 'ok' : 'failed' }
  }

  return {
    score,
    status: 'ok',
    details: {
      domain_rating: domainRating,
      ahrefs_rank: ahrefsData.ahrefs_rank,
      source: 'ahrefs_domain_rating',
      is_mock: isMock,
    },
  }
}
