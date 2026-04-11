/** Centralized prompt templates for the analysis pipeline */

export function contextAnalysisPrompt(domain: string, competitors: string[], targetTopic: string): string {
  const competitorStr = competitors.length > 0 ? `If available, consider its competitors: ${competitors.join(', ')}.` : ''
  const topicStr = targetTopic ? `Its target topic/sector: "${targetTopic}".` : ''

  return `As a market analyst, research the web for information about the company with domain "${domain}".
${competitorStr}
${topicStr}

Generate four distinct sections IN ENGLISH, each under 500 words:
1. **Company's Profile**: A summary of the company, its mission, history, and key products/services.
2. **Market Scenario**: An overview of the current market, including main trends, size, and the company's positioning against its competitors.
3. **Business Challenges**: Key challenges the company is facing, such as competitive pressure, market shifts, or operational issues.
4. **Last News**: Find the 3 most recent and relevant news articles from Google News about the company. For each, provide a title, a direct link, the source name, and a short snippet.`
}

export const contextAnalysisSchema = {
  type: 'object',
  properties: {
    company_profile: { type: 'string' },
    market_scenario: { type: 'string' },
    business_challenges: { type: 'string' },
    last_news: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          link: { type: 'string' },
          source: { type: 'string' },
          snippet: { type: 'string' },
        },
        required: ['title', 'link', 'source', 'snippet'],
      },
    },
  },
  required: ['company_profile', 'market_scenario', 'business_challenges', 'last_news'],
}

export function solutionsPrompt(
  driverName: string,
  domain: string,
  score: number,
  issues: { title: string; description: string; severity: string }[],
  numSolutions: number
): string {
  const issuesList = issues
    .map((i, idx) => `${idx + 1}. [${i.severity.toUpperCase()}] ${i.title}: ${i.description}`)
    .join('\n')

  return `You are an SEO expert analyzing the "${driverName}" driver for domain "${domain}".

Current Score: ${score}/100

Issues Found:
${issuesList}

Generate exactly ${numSolutions} actionable solution(s). For each provide:
- title: Brief action item (max 50 chars)
- description: Detailed implementation steps (100-200 words)
- impact: high/medium/low
- effort_level: high/medium/low
- estimated_improvement: Number 1-20 (points expected to gain)
- timeframe: quick_win (1-2 weeks), short_term (1-2 months), medium_term (3-6 months), long_term (6+ months)`
}

export const solutionsSchema = {
  type: 'object',
  properties: {
    solutions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          effort_level: { type: 'string', enum: ['high', 'medium', 'low'] },
          estimated_improvement: { type: 'number' },
          timeframe: { type: 'string', enum: ['quick_win', 'short_term', 'medium_term', 'long_term'] },
        },
        required: ['title', 'description', 'impact', 'effort_level', 'estimated_improvement', 'timeframe'],
      },
    },
  },
  required: ['solutions'],
}

export function priorityMatrixPrompt(
  solutions: { reference: string; driver: string; title: string; description: string; impact: string; effort_level: string; estimated_improvement: number; timeframe: string }[]
): string {
  const solutionsList = JSON.stringify(solutions, null, 2)

  return `Classify these ${solutions.length} solutions into 4 priority-impact quadrants.
For each solution keep its "reference" field.

SOLUTIONS: ${solutionsList}

QUADRANTS:
1. OPPORTUNITIES (high priority + high impact)
2. ISSUES (high priority + lower impact)
3. IMPROVEMENTS (medium priority + high impact)
4. SUGGESTIONS (low priority)`
}

export const priorityMatrixSchema = {
  type: 'object',
  properties: {
    opportunities: {
      type: 'array',
      items: { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'] },
    },
    issues: {
      type: 'array',
      items: { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'] },
    },
    improvements: {
      type: 'array',
      items: { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'] },
    },
    suggestions: {
      type: 'array',
      items: { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'] },
    },
  },
  required: ['opportunities', 'issues', 'improvements', 'suggestions'],
}
