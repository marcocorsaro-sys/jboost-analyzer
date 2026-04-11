import { clampScore, type DriverResult } from './utils'

/**
 * AI Relevance Driver
 * Source: Ahrefs organic-keywords with SERP features analysis
 * Formula:
 *   For each keyword:
 *     - If serp_features includes 'ai_overview' → aiOverviewCount++
 *     - If serp_features includes 'featured_snippet' → featuredSnippetCount++
 *   score = ((aiOverviewCount + featuredSnippetCount) / totalKeywords) × 100
 */
export function calculateAiRelevance(ahrefsAiData: Record<string, unknown> | null): DriverResult {
  if (!ahrefsAiData) {
    return { score: null, status: 'no_results' }
  }

  // Pre-calculated score from analysis runner
  const aiRelevanceScore = ahrefsAiData.ai_relevance_score as number | undefined

  if (aiRelevanceScore !== undefined) {
    const score = clampScore(aiRelevanceScore)
    return {
      score,
      status: score !== null ? 'ok' : 'failed',
      details: {
        ai_relevance_score: aiRelevanceScore,
        ai_overview_keywords: ahrefsAiData.ai_overview_keywords,
        featured_snippet_keywords: ahrefsAiData.featured_snippet_keywords,
        total_keywords: ahrefsAiData.total_keywords,
        source: 'ahrefs_organic_keywords',
      },
    }
  }

  // Raw keyword data — calculate from scratch
  const keywords = ahrefsAiData.keywords as Array<{
    keyword: string
    volume: number
    serp_features: string[]
  }> | undefined

  if (!keywords || keywords.length === 0) {
    return { score: null, status: 'no_results' }
  }

  let aiOverviewCount = 0
  let featuredSnippetCount = 0

  for (const kw of keywords) {
    const features = kw.serp_features || []
    if (features.includes('ai_overview') || features.includes('ai_overviews')) {
      aiOverviewCount++
    }
    if (features.includes('featured_snippet')) {
      featuredSnippetCount++
    }
  }

  const rawScore = ((aiOverviewCount + featuredSnippetCount) / keywords.length) * 100
  const score = clampScore(rawScore)

  return {
    score,
    status: score !== null ? 'ok' : 'failed',
    details: {
      ai_overview_keywords: aiOverviewCount,
      featured_snippet_keywords: featuredSnippetCount,
      total_keywords: keywords.length,
      source: 'ahrefs_organic_keywords',
    },
  }
}
