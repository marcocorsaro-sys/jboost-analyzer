import { clampScore, type DriverResult } from './utils'

/**
 * Accessibility Driver
 * Source: Google PageSpeed Insights — accessibility score
 * Formula: Direct mapping (already 0-100 after normalization)
 */
export function calculateAccessibility(psiData: Record<string, unknown> | null): DriverResult {
  if (!psiData) {
    return { score: null, status: 'no_results' }
  }

  let accessibilityScore = psiData.accessibility_score as number | undefined

  // Handle raw Lighthouse format (0-1 scale)
  if (accessibilityScore !== undefined && accessibilityScore <= 1) {
    accessibilityScore = accessibilityScore * 100
  }

  const score = clampScore(accessibilityScore)

  if (score === null) {
    return { score: null, status: 'failed' }
  }

  return {
    score,
    status: 'ok',
    details: {
      accessibility_score: accessibilityScore,
      source: 'google_psi_accessibility',
    },
  }
}
