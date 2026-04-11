// 9 JBoost Drivers with weights (Bug #8: transparent driver weights)
export const DRIVERS = [
  { key: 'compliance', label: 'Compliance', icon: 'Shield', weight: 1, description: 'Technical health of the website from SEMrush Site Audit' },
  { key: 'experience', label: 'Experience', icon: 'Gauge', weight: 1, description: 'Page performance from Google PageSpeed Insights (mobile)' },
  { key: 'discoverability', label: 'Discoverability', icon: 'Search', weight: 1, description: 'Organic search visibility via SEMrush ranking' },
  { key: 'content', label: 'Content', icon: 'FileText', weight: 1, description: 'Content quality based on site audit error density' },
  { key: 'accessibility', label: 'Accessibility', icon: 'Accessibility', weight: 1, description: 'WCAG compliance from Lighthouse accessibility audit' },
  { key: 'authority', label: 'Authority', icon: 'Award', weight: 1, description: 'Domain authority from Ahrefs Domain Rating (0-100)' },
  { key: 'aso_visibility', label: 'ASO Visibility', icon: 'Smartphone', weight: 1, description: 'Paid search presence from SEMrush Adwords metrics' },
  { key: 'ai_relevance', label: 'AI Relevance', icon: 'Brain', weight: 1, description: 'Presence in AI Overviews and Featured Snippets from Ahrefs' },
  { key: 'awareness', label: 'Awareness', icon: 'Eye', weight: 1, description: 'Brand awareness based on search volume trends' },
] as const

export type DriverKey = typeof DRIVERS[number]['key']

// Score bands for interpretation
export const SCORE_BANDS = [
  { min: 0, max: 40, label: 'Critico', color: 'red', cssClass: 'score-critical' },
  { min: 41, max: 60, label: 'Da migliorare', color: 'amber', cssClass: 'score-improve' },
  { min: 61, max: 80, label: 'Buono', color: 'teal', cssClass: 'score-good' },
  { min: 81, max: 100, label: 'Eccellente', color: 'green', cssClass: 'score-excellent' },
] as const

export function getScoreBand(score: number | null) {
  if (score === null || score === undefined) return null
  return SCORE_BANDS.find(b => score >= b.min && score <= b.max) ?? SCORE_BANDS[0]
}

// Analysis status
export type AnalysisStatus = 'pending' | 'running' | 'completed' | 'failed'

// Driver status
export type DriverStatus = 'ok' | 'no_results' | 'failed' | 'manual'

// Priority matrix quadrants
export const PRIORITY_QUADRANTS = [
  { key: 'opportunities', label: 'Opportunities', description: 'High priority + High impact' },
  { key: 'issues', label: 'Issues', description: 'High priority + Lower impact' },
  { key: 'improvements', label: 'Improvements', description: 'Medium priority + High impact' },
  { key: 'suggestions', label: 'Suggestions', description: 'Low priority' },
] as const

// Max competitors
export const MAX_COMPETITORS = 4

// Scoring methodology explanation (Bug #9: absolute vs relative not communicated)
export const SCORING_INFO = {
  title: 'How Scoring Works',
  description: 'All scores are absolute measurements (0-100) derived from third-party API data (SEMrush, Ahrefs, Google PageSpeed). They reflect your site\'s performance against industry best practices, NOT relative to your competitors. Competitor scores are shown separately for benchmarking.',
  bands: [
    { range: '0-40', label: 'Critical', meaning: 'Significant issues requiring immediate attention' },
    { range: '41-60', label: 'Needs Improvement', meaning: 'Below average, action recommended' },
    { range: '61-80', label: 'Good', meaning: 'Solid performance, minor optimizations possible' },
    { range: '81-100', label: 'Excellent', meaning: 'Top-tier performance in this area' },
  ],
} as const

// Analysis phase labels for progress tracking
export const ANALYSIS_PHASES = [
  { key: 'initializing', label: 'Initializing' },
  { key: 'fetching_apis', label: 'Fetching API Data' },
  { key: 'calculating_scores', label: 'Calculating Scores' },
  { key: 'generating_issues', label: 'Identifying Issues' },
  { key: 'generating_solutions', label: 'Generating Solutions' },
  { key: 'analyzing_competitors', label: 'Analyzing Competitors' },
  { key: 'generating_matrix', label: 'Building Priority Matrix' },
  { key: 'finalizing', label: 'Finalizing' },
  { key: 'completed', label: 'Completed' },
] as const
