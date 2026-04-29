export { calculateCompliance } from './compliance'
export { calculateExperience } from './experience'
export { calculateDiscoverability } from './discoverability'
export { calculateContent } from './content'
export { calculateAccessibility } from './accessibility'
export { calculateAuthority } from './authority'
export { calculateAsoVisibility } from './aso-visibility'
export { calculateAiRelevance } from './ai-relevance'
export { calculateAwareness } from './awareness'
export { clampScore, normalizeSemrushRow } from './utils'
export type { DriverResult, SemrushNorm } from './utils'

import { calculateCompliance } from './compliance'
import { calculateExperience } from './experience'
import { calculateDiscoverability } from './discoverability'
import { calculateContent } from './content'
import { calculateAccessibility } from './accessibility'
import { calculateAuthority } from './authority'
import { calculateAsoVisibility } from './aso-visibility'
import { calculateAiRelevance } from './ai-relevance'
import { calculateAwareness } from './awareness'
import type { DriverResult } from './utils'

export interface ApiDataMap {
  semrush_domain_rank?: Record<string, unknown>
  semrush_site_health?: Record<string, unknown>
  ahrefs_domain_rating?: Record<string, unknown>
  ahrefs_ai_relevance?: Record<string, unknown>
  psi_mobile?: Record<string, unknown>
  trends_brand_awareness?: Record<string, unknown>
  /**
   * Phase 7B: output di `scanAIOverviewVisibility` da DataForSEO. Se
   * presente, ha precedenza sul fallback Ahrefs nel driver
   * `calculateAiRelevance`. Vedi lib/integrations/providers/dataforseo.
   */
  dataforseo_ai_overview?: Record<string, unknown>
}

/**
 * Calculate all 9 driver scores from API data.
 * Returns a map of driver_name → DriverResult
 */
export function calculateAllDrivers(apiData: ApiDataMap): Record<string, DriverResult> {
  return {
    compliance: calculateCompliance(apiData.semrush_site_health ?? null),
    experience: calculateExperience(apiData.psi_mobile ?? null),
    discoverability: calculateDiscoverability(apiData.semrush_domain_rank ?? null),
    content: calculateContent(apiData.semrush_site_health ?? null),
    accessibility: calculateAccessibility(apiData.psi_mobile ?? null),
    authority: calculateAuthority(apiData.ahrefs_domain_rating ?? null),
    aso_visibility: calculateAsoVisibility(apiData.semrush_domain_rank ?? null),
    ai_relevance: calculateAiRelevance(
      apiData.ahrefs_ai_relevance ?? null,
      apiData.dataforseo_ai_overview ?? null,
    ),
    awareness: calculateAwareness(apiData.trends_brand_awareness ?? null),
  }
}

/**
 * Calculate overall score from individual driver results.
 * Only includes drivers with status 'ok'.
 */
export function calculateOverallScore(driverResults: Record<string, DriverResult>): number | null {
  const validScores = Object.values(driverResults)
    .filter(r => r.status === 'ok' && r.score !== null)
    .map(r => r.score!)

  if (validScores.length === 0) return null

  return Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
}
