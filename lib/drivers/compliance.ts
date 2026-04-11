import { clampScore, type DriverResult } from './utils'

/**
 * Compliance Driver
 * Source: SEMrush Site Health score (0-100)
 * Formula: Direct mapping — site_health_score as-is
 */
export function calculateCompliance(siteHealthData: Record<string, unknown> | null): DriverResult {
  if (!siteHealthData) {
    return { score: null, status: 'no_results' }
  }

  const siteHealthScore = siteHealthData.site_health_score ??
    (siteHealthData.quality as Record<string, any>)?.value ??
    null

  const score = clampScore(siteHealthScore)

  if (score === null) {
    return { score: null, status: 'failed' }
  }

  return {
    score,
    status: 'ok',
    details: {
      site_health_score: siteHealthScore,
      source: 'semrush_site_health',
    },
  }
}
