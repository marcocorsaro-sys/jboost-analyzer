import { clampScore, type DriverResult } from './utils'

/**
 * AI Relevance Driver
 *
 * Two-source design (Phase 7B):
 *
 * 1. **DataForSEO** (preferred, when available): live SERP scan of N keyword
 *    of the client to detect actual AI Overview / Featured Snippet / People
 *    Also Ask presence. Provides accurate, real-time data.
 *    Source key: `apiData.dataforseo_ai_overview` (output di
 *    `scanAIOverviewVisibility` in `lib/integrations/providers/dataforseo`).
 *    Score = aiOverviewPercentage del summary.
 *
 * 2. **Ahrefs organic-keywords** (fallback, legacy): SERP features metadata
 *    statici da Ahrefs. Meno preciso ma già cablato dal Phase 4. Usato
 *    quando DataForSEO non è disponibile o il summary è vuoto.
 *    Score = ((aiOverviewCount + featuredSnippetCount) / totalKeywords) * 100
 *
 * Il secondo argomento `dataforseoAiData` è opzionale e additive — i call
 * site che non lo passano continuano a funzionare invariati.
 */
export function calculateAiRelevance(
  ahrefsAiData: Record<string, unknown> | null,
  dataforseoAiData: Record<string, unknown> | null = null,
): DriverResult {
  // Preferred path: DataForSEO live SERP scan
  if (dataforseoAiData) {
    const dfsScore = dataforseoAiData.aiOverviewPercentage as number | undefined
    const dfsTotal = dataforseoAiData.totalKeywords as number | undefined
    const dfsSuccess = dataforseoAiData.successCount as number | undefined
    if (typeof dfsScore === 'number' && dfsTotal && dfsSuccess && dfsSuccess > 0) {
      const score = clampScore(dfsScore)
      return {
        score,
        status: score !== null ? 'ok' : 'failed',
        details: {
          ai_relevance_score: dfsScore,
          ai_overview_keywords: dataforseoAiData.aiOverviewCount,
          featured_snippet_keywords: dataforseoAiData.featuredSnippetCount,
          people_also_ask_keywords: dataforseoAiData.peopleAlsoAskCount,
          total_keywords: dfsTotal,
          successful_keywords: dfsSuccess,
          client_top10_count: dataforseoAiData.clientTop10Count,
          total_cost_usd: dataforseoAiData.totalCostUsd,
          source: 'dataforseo_serp_live',
        },
      }
    }
  }

  // Fallback: Ahrefs organic-keywords (legacy path)
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
