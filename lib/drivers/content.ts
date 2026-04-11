import { clampScore, type DriverResult } from './utils'

/**
 * Content Driver
 * Source: SEMrush Site Audit — error issues + pages crawled
 * Formula: score = max(1, 100 × e^(-errorRatio × 1.0))
 *   where errorRatio = totalErrorPages / pagesCrawled
 */
export function calculateContent(siteHealthData: Record<string, unknown> | null): DriverResult {
  if (!siteHealthData) {
    return { score: null, status: 'no_results' }
  }

  const issues = siteHealthData.issues as Array<{ type: string; pages_count: number }> | undefined
  const meta = siteHealthData._meta as { pages_crawled: number } | undefined
  const pagesCrawled = meta?.pages_crawled ?? (siteHealthData.pages_crawled as number | undefined) ?? 0

  if (!issues || pagesCrawled <= 0) {
    return { score: null, status: 'failed' }
  }

  // Sum error pages
  const totalErrorPages = issues
    .filter(issue => issue.type === 'error')
    .reduce((sum, issue) => sum + (issue.pages_count || 0), 0)

  const errorRatio = totalErrorPages / pagesCrawled

  // Exponential decay: few errors = high score, many = low
  const rawScore = Math.max(1, 100 * Math.exp(-errorRatio * 1.0))

  const score = clampScore(rawScore)

  return {
    score,
    status: score !== null ? 'ok' : 'failed',
    details: {
      totalErrorPages,
      pagesCrawled,
      errorRatio: Math.round(errorRatio * 1000) / 1000,
      source: 'semrush_site_audit',
    },
  }
}
