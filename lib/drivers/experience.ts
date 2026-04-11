import { clampScore, type DriverResult } from './utils'

/**
 * Experience Driver
 * Source: Google PageSpeed Insights — performance score
 * Formula: performance_score (already 0-100 after ×100 normalization)
 */
export function calculateExperience(psiData: Record<string, unknown> | null): DriverResult {
  if (!psiData) {
    return { score: null, status: 'no_results' }
  }

  // PSI returns score as 0-1, we expect it pre-multiplied by 100
  let performanceScore = psiData.performance_score as number | undefined

  // Handle raw Lighthouse format (0-1 scale)
  if (performanceScore !== undefined && performanceScore <= 1) {
    performanceScore = performanceScore * 100
  }

  const score = clampScore(performanceScore)

  if (score === null) {
    return { score: null, status: 'failed' }
  }

  return {
    score,
    status: 'ok',
    details: {
      performance_score: performanceScore,
      source: 'google_psi_mobile',
    },
  }
}
