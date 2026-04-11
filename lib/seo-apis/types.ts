// Shared types for all SEO API clients

export interface SemrushDomainOverview {
  rank: number
  organicKeywords: number
  organicTraffic: number
  organicCost: number
  adwordsKeywords: number
  adwordsTraffic: number
  adwordsCost: number
}

export interface SemrushKeywordLoss {
  keyword: string
  position: number
  previousPosition: number
  positionDifference: number
  traffic: number
  searchVolume: number
}

export interface SemrushBrandedKeywords {
  count: number
  totalBrandedTraffic: number
}

export interface SemrushRankHistory {
  date: string
  rank: number
  organicKeywords: number
  organicTraffic: number
}

export interface SemrushSiteHealth {
  site_health_score: number | null
  issues: SemrushSiteIssue[]
  pages_crawled: number
}

export interface SemrushSiteIssue {
  id: string
  title: string
  type: 'error' | 'warning' | 'notice'
  pages_count: number
}

export interface AhrefsDomainRating {
  domain_rating: number
  ahrefs_rank: number
}

export interface AhrefsAiRelevance {
  ai_relevance_score: number
  ai_overview_keywords: number
  featured_snippet_keywords: number
  people_also_ask_keywords: number
  total_keywords: number
}

export interface AhrefsSerpFeatures {
  featured_snippet: number
  people_also_ask: number
  ai_overview: number
  sitelinks: number
  knowledge_panel: number
  total_keywords: number
}

export interface AhrefsBrokenBacklink {
  url_from: string
  url_to: string
  domain_rating_source: number
  http_code: number
  first_seen: string
}

export interface AhrefsRefdomainsHistory {
  date: string
  refdomains: number
}

export interface PageSpeedResult {
  performance_score: number
  accessibility_score: number
}

export interface PageSpeedFailedAudit {
  id: string
  title: string
  description: string
  score: number
  displayValue?: string
  metricType?: string
}

export interface GoogleTrendsResult {
  latestRank: number
  average: number
  latest: number
  timeline: { date: string; value: number }[]
}

// Meta wrapper for all API responses
export interface ApiResponse<T> {
  data: T
  _meta: {
    is_mock: boolean
    source: string
    fetched_at: string
    error?: string
  }
}

// Driver issue type
export interface DriverIssue {
  title: string
  description: string
  severity: 'high' | 'medium' | 'low'
  source: string
}
