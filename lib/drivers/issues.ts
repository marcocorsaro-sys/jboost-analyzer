import type { DriverIssue } from '../seo-apis/types'

const MAX_ISSUES = 3

/** Generate deterministic issues for all 9 drivers based on raw API data */
export function generateAllDriverIssues(apiDataMap: Record<string, unknown>): Record<string, DriverIssue[]> {
  return {
    compliance: generateComplianceIssues(apiDataMap),
    experience: generateExperienceIssues(apiDataMap),
    discoverability: generateDiscoverabilityIssues(apiDataMap),
    content: generateContentIssues(apiDataMap),
    accessibility: generateAccessibilityIssues(apiDataMap),
    authority: generateAuthorityIssues(apiDataMap),
    'ai-relevance': generateAiRelevanceIssues(apiDataMap),
    awareness: generateAwarenessIssues(apiDataMap),
    'aso-visibility': generateAsoIssues(apiDataMap),
  }
}

function generateComplianceIssues(data: Record<string, unknown>): DriverIssue[] {
  const issues: DriverIssue[] = []
  const siteHealth = data.semrush_site_health as Record<string, unknown> | undefined
  if (!siteHealth) return issues

  const auditIssues = (siteHealth.issues || []) as Array<Record<string, unknown>>
  // Sort: error > warning > notice, then by pages_count desc
  const sorted = [...auditIssues].sort((a, b) => {
    const typeOrder: Record<string, number> = { error: 0, critical: 0, warning: 1, notice: 2 }
    const aOrder = typeOrder[String(a.type || 'notice')] ?? 2
    const bOrder = typeOrder[String(b.type || 'notice')] ?? 2
    if (aOrder !== bOrder) return aOrder - bOrder
    return Number(b.pages_count || 0) - Number(a.pages_count || 0)
  })

  for (const issue of sorted.slice(0, MAX_ISSUES)) {
    const type = String(issue.type || 'warning')
    issues.push({
      title: String(issue.title || issue.name || 'Site Audit Issue'),
      description: `Affects ${issue.pages_count || 0} pages. Type: ${type}.`,
      severity: type === 'error' || type === 'critical' ? 'high' : type === 'warning' ? 'medium' : 'low',
      source: 'SEMrush Site Audit',
    })
  }

  // Add low health score issue if not enough issues found
  const healthScore = Number(siteHealth.site_health_score || 100)
  if (healthScore < 80 && issues.length < MAX_ISSUES) {
    issues.push({
      title: 'Low Site Health Score',
      description: `Site health score is ${healthScore}/100, indicating significant technical issues that need attention.`,
      severity: healthScore < 50 ? 'high' : 'medium',
      source: 'SEMrush Site Audit',
    })
  }

  return issues.slice(0, MAX_ISSUES)
}

function generateExperienceIssues(data: Record<string, unknown>): DriverIssue[] {
  const issues: DriverIssue[] = []
  const failedAudits = (data.pagespeed_failed_audits || []) as Array<Record<string, unknown>>

  for (const audit of failedAudits.slice(0, MAX_ISSUES)) {
    const score = Number(audit.score || 0)
    issues.push({
      title: String(audit.title || 'Performance Issue'),
      description: String(audit.displayValue || audit.description || `Score: ${Math.round(score * 100)}/100`),
      severity: score < 0.5 ? 'high' : 'medium',
      source: 'Google PageSpeed Insights',
    })
  }

  return issues
}

function generateDiscoverabilityIssues(data: Record<string, unknown>): DriverIssue[] {
  const issues: DriverIssue[] = []
  const losingKw = (data.semrush_organic_losing || []) as Array<Record<string, unknown>>

  // Sort by |positionDifference| × traffic descending
  const sorted = [...losingKw].sort((a, b) => {
    const aImpact = Math.abs(Number(a.positionDifference || 0)) * Number(a.traffic || 0)
    const bImpact = Math.abs(Number(b.positionDifference || 0)) * Number(b.traffic || 0)
    return bImpact - aImpact
  })

  for (const kw of sorted.slice(0, MAX_ISSUES)) {
    const drop = Math.abs(Number(kw.positionDifference || 0))
    issues.push({
      title: `Keyword "${kw.keyword}" dropped ${drop} positions`,
      description: `Now at position ${kw.position} (was ${kw.previousPosition}). Estimated traffic loss: ${Math.round(Number(kw.traffic || 0))}.`,
      severity: drop > 10 ? 'high' : 'medium',
      source: 'SEMrush Organic',
    })
  }

  return issues
}

function generateContentIssues(data: Record<string, unknown>): DriverIssue[] {
  const issues: DriverIssue[] = []
  const siteHealth = data.semrush_site_health as Record<string, unknown> | undefined
  if (!siteHealth) return issues

  const auditIssues = (siteHealth.issues || []) as Array<Record<string, unknown>>
  const pagesCrawled = Number(siteHealth.pages_crawled || 1)

  // Filter error-type issues, sort by pages_count desc
  const errorIssues = auditIssues
    .filter((i) => String(i.type) === 'error' || String(i.type) === 'critical')
    .sort((a, b) => Number(b.pages_count || 0) - Number(a.pages_count || 0))

  for (const issue of errorIssues.slice(0, MAX_ISSUES)) {
    const pagesCount = Number(issue.pages_count || 0)
    const pctAffected = pagesCrawled > 0 ? Math.round((pagesCount / pagesCrawled) * 100) : 0
    issues.push({
      title: String(issue.title || issue.name || 'Content Error'),
      description: `Affects ${pagesCount} pages (${pctAffected}% of crawled pages).`,
      severity: pagesCount > pagesCrawled * 0.1 ? 'high' : 'medium',
      source: 'SEMrush Site Audit',
    })
  }

  return issues
}

function generateAccessibilityIssues(data: Record<string, unknown>): DriverIssue[] {
  const issues: DriverIssue[] = []
  const failedAudits = (data.pagespeed_failed_audits || []) as Array<Record<string, unknown>>

  // Filter accessibility-related audits
  const a11yAudits = failedAudits.filter((a) => {
    const id = String(a.id || '')
    return id.includes('aria') || id.includes('color-contrast') || id.includes('image-alt') ||
      id.includes('label') || id.includes('link-name') || id.includes('heading') ||
      id.includes('tabindex') || id.includes('accessib')
  })

  for (const audit of a11yAudits.slice(0, MAX_ISSUES)) {
    const score = Number(audit.score || 0)
    issues.push({
      title: String(audit.title || 'Accessibility Issue'),
      description: String(audit.description || `Score: ${Math.round(score * 100)}/100`),
      severity: score < 0.5 ? 'high' : 'medium',
      source: 'Google Lighthouse',
    })
  }

  return issues
}

function generateAuthorityIssues(data: Record<string, unknown>): DriverIssue[] {
  const issues: DriverIssue[] = []

  // Broken backlinks
  const brokenBacklinks = (data.ahrefs_broken_backlinks || []) as Array<Record<string, unknown>>
  const topBroken = brokenBacklinks
    .sort((a, b) => Number(b.domain_rating_source || 0) - Number(a.domain_rating_source || 0))
    .slice(0, 2)

  for (const bl of topBroken) {
    const dr = Number(bl.domain_rating_source || 0)
    issues.push({
      title: `Lost backlink from DR${dr} domain`,
      description: `Broken link from ${bl.url_from} to ${bl.url_to} (HTTP ${bl.http_code}).`,
      severity: dr > 50 ? 'high' : 'medium',
      source: 'Ahrefs',
    })
  }

  // Declining refdomains
  const refHistory = (data.ahrefs_refdomains_history || []) as Array<Record<string, unknown>>
  if (refHistory.length >= 6) {
    const recent3 = refHistory.slice(-3)
    const earlier3 = refHistory.slice(-6, -3)
    const recentAvg = recent3.reduce((s, r) => s + Number(r.refdomains || 0), 0) / 3
    const earlierAvg = earlier3.reduce((s, r) => s + Number(r.refdomains || 0), 0) / 3
    if (earlierAvg > 0) {
      const decline = ((earlierAvg - recentAvg) / earlierAvg) * 100
      if (decline > 5 && issues.length < MAX_ISSUES) {
        issues.push({
          title: 'Referring Domains Declining',
          description: `Referring domains dropped ${Math.round(decline)}% over the last 3 months (from ~${Math.round(earlierAvg)} to ~${Math.round(recentAvg)}).`,
          severity: decline > 15 ? 'high' : 'medium',
          source: 'Ahrefs',
        })
      }
    }
  }

  return issues.slice(0, MAX_ISSUES)
}

function generateAiRelevanceIssues(data: Record<string, unknown>): DriverIssue[] {
  const issues: DriverIssue[] = []
  const aiData = data.ahrefs_ai_relevance as Record<string, unknown> | undefined
  if (!aiData) return issues

  const totalKw = Number(aiData.total_keywords || 0)
  const aiOverview = Number(aiData.ai_overview_keywords || 0)
  const featuredSnippet = Number(aiData.featured_snippet_keywords || 0)
  const paa = Number(aiData.people_also_ask_keywords || 0)

  if (aiOverview === 0 && totalKw > 0) {
    issues.push({
      title: 'Zero AI Overview Presence',
      description: `None of the ${totalKw} tracked keywords trigger AI Overviews. The site has no visibility in AI-generated search results.`,
      severity: 'high',
      source: 'Ahrefs',
    })
  }

  if (totalKw > 0 && featuredSnippet / totalKw < 0.1) {
    issues.push({
      title: 'Low Featured Snippet Presence',
      description: `Only ${featuredSnippet} out of ${totalKw} keywords (${Math.round((featuredSnippet / totalKw) * 100)}%) have featured snippets.`,
      severity: 'high',
      source: 'Ahrefs',
    })
  }

  if (totalKw > 0 && paa / totalKw < 0.05 && issues.length < MAX_ISSUES) {
    issues.push({
      title: 'Rare People Also Ask Appearance',
      description: `Only ${paa} keywords (${Math.round((paa / totalKw) * 100)}%) appear in People Also Ask sections.`,
      severity: 'medium',
      source: 'Ahrefs',
    })
  }

  return issues.slice(0, MAX_ISSUES)
}

function generateAwarenessIssues(data: Record<string, unknown>): DriverIssue[] {
  const issues: DriverIssue[] = []

  // Check organic traffic trend from brand awareness data
  const brandHistory = (data.semrush_brand_awareness || []) as Array<Record<string, unknown>>
  if (brandHistory.length >= 6) {
    const recent3 = brandHistory.slice(-3)
    const earlier3 = brandHistory.slice(-6, -3)
    const recentAvg = recent3.reduce((s, r) => s + Number(r.organicTraffic || 0), 0) / 3
    const earlierAvg = earlier3.reduce((s, r) => s + Number(r.organicTraffic || 0), 0) / 3
    if (earlierAvg > 0) {
      const decline = ((earlierAvg - recentAvg) / earlierAvg) * 100
      if (decline > 10) {
        issues.push({
          title: 'Organic Traffic Declining',
          description: `Organic traffic dropped ${Math.round(decline)}% over the last 3 months.`,
          severity: decline > 25 ? 'high' : 'medium',
          source: 'SEMrush',
        })
      }
    }
  }

  // Check branded keyword coverage
  const branded = data.semrush_branded_keywords as Record<string, unknown> | undefined
  if (branded) {
    const count = Number(branded.count || 0)
    if (count < 10) {
      issues.push({
        title: 'Low Branded Keyword Coverage',
        description: `Only ${count} branded keywords detected. This suggests low brand search visibility.`,
        severity: count < 5 ? 'high' : 'medium',
        source: 'SEMrush',
      })
    }
  }

  return issues.slice(0, MAX_ISSUES)
}

function generateAsoIssues(data: Record<string, unknown>): DriverIssue[] {
  const issues: DriverIssue[] = []
  const overview = data.semrush_domain_overview as Record<string, unknown> | undefined
  if (!overview) return issues

  const adwordsKw = Number(overview.adwordsKeywords || 0)
  const organicKw = Number(overview.organicKeywords || 0)

  if (adwordsKw === 0 && organicKw > 0) {
    issues.push({
      title: 'No Paid Search Presence',
      description: `The domain has ${organicKw} organic keywords but no paid search (Adwords) keywords, indicating zero paid visibility.`,
      severity: 'high',
      source: 'SEMrush',
    })
  }

  return issues
}
