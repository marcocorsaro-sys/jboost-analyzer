import type { PageSpeedResult, PageSpeedFailedAudit, ApiResponse } from './types'

const PSI_API_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

function getApiKey(): string {
  const key = process.env.GOOGLE_PSI_API_KEY
  if (!key) throw new Error('GOOGLE_PSI_API_KEY not configured')
  return key
}

function mockResponse<T>(data: T, source: string): ApiResponse<T> {
  return {
    data,
    _meta: { is_mock: true, source, fetched_at: new Date().toISOString() },
  }
}

function realResponse<T>(data: T, source: string): ApiResponse<T> {
  return {
    data,
    _meta: { is_mock: false, source, fetched_at: new Date().toISOString() },
  }
}

/** Summarize raw PSI data into what drivers need */
export function summarizePageSpeed(lighthouseResult: Record<string, unknown>): PageSpeedResult {
  const categories = lighthouseResult.categories as Record<string, { score: number }> | undefined
  const perfScore = categories?.performance?.score ?? 0
  const a11yScore = categories?.accessibility?.score ?? 0
  return {
    performance_score: Math.round(perfScore * 100),
    accessibility_score: Math.round(a11yScore * 100),
  }
}

/** Google PageSpeed Insights — mobile */
export async function fetchPageSpeed(
  domain: string,
  strategy: 'mobile' | 'desktop' = 'mobile'
): Promise<ApiResponse<PageSpeedResult>> {
  const source = `pagespeed_${strategy}`
  try {
    const url = `${PSI_API_BASE}?url=https://${domain}&key=${getApiKey()}&strategy=${strategy}&category=performance&category=accessibility`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`PSI ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const result = summarizePageSpeed(data.lighthouseResult || {})
    return realResponse(result, source)
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<PageSpeedResult>(
      { performance_score: 0, accessibility_score: 0 },
      source
    )
  }
}

/** Google PageSpeed — failed audits only */
export async function fetchPageSpeedFailedAudits(
  domain: string,
  strategy: 'mobile' | 'desktop' = 'mobile'
): Promise<ApiResponse<PageSpeedFailedAudit[]>> {
  const source = `pagespeed_failed_audits_${strategy}`
  try {
    const url = `${PSI_API_BASE}?url=https://${domain}&key=${getApiKey()}&strategy=${strategy}&category=performance&category=accessibility`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`PSI ${res.status}`)
    const data = await res.json()

    const audits = data.lighthouseResult?.audits || {}
    const failedAudits: PageSpeedFailedAudit[] = []

    for (const [id, audit] of Object.entries(audits)) {
      const a = audit as Record<string, unknown>
      const score = Number(a.score ?? 1)
      if (score < 1 && score !== null && a.title) {
        failedAudits.push({
          id,
          title: String(a.title),
          description: String(a.description || ''),
          score,
          displayValue: a.displayValue ? String(a.displayValue) : undefined,
          metricType: inferMetricType(id),
        })
      }
    }

    // Sort by score ascending (worst first)
    failedAudits.sort((a, b) => a.score - b.score)

    return realResponse(failedAudits, source)
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<PageSpeedFailedAudit[]>([], source)
  }
}

function inferMetricType(auditId: string): string | undefined {
  if (auditId.includes('largest-contentful-paint')) return 'LCP'
  if (auditId.includes('cumulative-layout-shift')) return 'CLS'
  if (auditId.includes('total-blocking-time')) return 'TBT'
  if (auditId.includes('first-contentful-paint')) return 'FCP'
  if (auditId.includes('interaction-to-next-paint') || auditId.includes('inp')) return 'INP'
  return undefined
}
