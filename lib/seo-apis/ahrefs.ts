import type {
  AhrefsDomainRating,
  AhrefsAiRelevance,
  AhrefsSerpFeatures,
  AhrefsBrokenBacklink,
  AhrefsRefdomainsHistory,
  ApiResponse,
} from './types'

const AHREFS_API_BASE = 'https://api.ahrefs.com/v3'

function getApiKey(): string {
  const key = process.env.AHREFS_API_KEY
  if (!key) throw new Error('AHREFS_API_KEY not configured')
  return key
}

function headers() {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    Accept: 'application/json',
  }
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

/** Ahrefs Domain Rating */
export async function fetchDomainRating(
  domain: string
): Promise<ApiResponse<AhrefsDomainRating>> {
  const source = 'ahrefs_domain_rating'
  try {
    const url = `${AHREFS_API_BASE}/site-explorer/domain-rating?target=${encodeURIComponent(domain)}&output=json`
    const res = await fetch(url, { headers: headers() })
    if (res.status === 403) {
      console.warn(`[${source}] 403 - using mock DR=50`)
      return mockResponse({ domain_rating: 50, ahrefs_rank: 0 }, source)
    }
    if (!res.ok) throw new Error(`Ahrefs ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return realResponse<AhrefsDomainRating>(
      {
        domain_rating: Math.round(data.domain_rating ?? 0),
        ahrefs_rank: data.ahrefs_rank ?? 0,
      },
      source
    )
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse({ domain_rating: 50, ahrefs_rank: 0 }, source)
  }
}

/** Ahrefs AI Relevance — organic keywords with SERP features */
export async function fetchAiRelevance(
  domain: string,
  country: string = 'us'
): Promise<ApiResponse<AhrefsAiRelevance>> {
  const source = 'ahrefs_ai_relevance'
  try {
    const url = `${AHREFS_API_BASE}/site-explorer/organic-keywords?target=${encodeURIComponent(domain)}&country=${country}&select=keyword,volume,serp_features&limit=1000&output=json`
    const res = await fetch(url, { headers: headers() })
    if (!res.ok) throw new Error(`Ahrefs ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const keywords = data.keywords || data.organic_keywords || []
    const total = keywords.length

    let aiOverviewCount = 0
    let featuredSnippetCount = 0
    let paaCount = 0

    for (const kw of keywords) {
      const features = kw.serp_features || kw.serp_items || []
      const featureSet = Array.isArray(features) ? features : [features]
      for (const f of featureSet) {
        const name = typeof f === 'string' ? f.toLowerCase() : String(f?.name || f?.type || '').toLowerCase()
        if (name.includes('ai_overview') || name.includes('ai_overviews') || name.includes('ai overview') || name.includes('sgr')) {
          aiOverviewCount++
          break
        }
      }
      for (const f of featureSet) {
        const name = typeof f === 'string' ? f.toLowerCase() : String(f?.name || f?.type || '').toLowerCase()
        if (name.includes('featured_snippet') || name.includes('featured snippet')) {
          featuredSnippetCount++
          break
        }
      }
      for (const f of featureSet) {
        const name = typeof f === 'string' ? f.toLowerCase() : String(f?.name || f?.type || '').toLowerCase()
        if (name.includes('people_also_ask') || name.includes('people also ask')) {
          paaCount++
          break
        }
      }
    }

    const score = total > 0
      ? Math.round(((aiOverviewCount + featuredSnippetCount) / total) * 100)
      : 0

    return realResponse<AhrefsAiRelevance>(
      {
        ai_relevance_score: score,
        ai_overview_keywords: aiOverviewCount,
        featured_snippet_keywords: featuredSnippetCount,
        people_also_ask_keywords: paaCount,
        total_keywords: total,
      },
      source
    )
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<AhrefsAiRelevance>(
      { ai_relevance_score: 0, ai_overview_keywords: 0, featured_snippet_keywords: 0, people_also_ask_keywords: 0, total_keywords: 0 },
      source
    )
  }
}

/** Ahrefs SERP Features breakdown */
export async function fetchSerpFeatures(
  domain: string,
  country: string = 'us'
): Promise<ApiResponse<AhrefsSerpFeatures>> {
  const source = 'ahrefs_serp_features'
  try {
    const url = `${AHREFS_API_BASE}/site-explorer/organic-keywords?target=${encodeURIComponent(domain)}&country=${country}&select=keyword,serp_features&limit=1000&output=json`
    const res = await fetch(url, { headers: headers() })
    if (!res.ok) throw new Error(`Ahrefs ${res.status}`)
    const data = await res.json()
    const keywords = data.keywords || data.organic_keywords || []

    const counts: Record<string, number> = {
      featured_snippet: 0,
      people_also_ask: 0,
      ai_overview: 0,
      sitelinks: 0,
      knowledge_panel: 0,
    }

    for (const kw of keywords) {
      const features = kw.serp_features || []
      const featureSet = Array.isArray(features) ? features : [features]
      for (const f of featureSet) {
        const name = typeof f === 'string' ? f.toLowerCase() : String(f?.name || f?.type || '').toLowerCase()
        if (name.includes('featured_snippet') || name.includes('featured snippet')) counts.featured_snippet++
        if (name.includes('people_also_ask') || name.includes('people also ask')) counts.people_also_ask++
        if (name.includes('ai_overview') || name.includes('ai_overviews') || name.includes('sgr')) counts.ai_overview++
        if (name.includes('sitelinks')) counts.sitelinks++
        if (name.includes('knowledge') || name.includes('knowledge_panel')) counts.knowledge_panel++
      }
    }

    return realResponse<AhrefsSerpFeatures>(
      { ...counts, total_keywords: keywords.length } as AhrefsSerpFeatures,
      source
    )
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<AhrefsSerpFeatures>(
      { featured_snippet: 0, people_also_ask: 0, ai_overview: 0, sitelinks: 0, knowledge_panel: 0, total_keywords: 0 },
      source
    )
  }
}

/** Ahrefs Broken Backlinks */
export async function fetchBrokenBacklinks(
  domain: string
): Promise<ApiResponse<AhrefsBrokenBacklink[]>> {
  const source = 'ahrefs_broken_backlinks'
  try {
    const url = `${AHREFS_API_BASE}/site-explorer/broken-backlinks?target=${encodeURIComponent(domain)}&select=url_from,url_to,domain_rating_source,http_code,first_seen&limit=10&order_by=domain_rating_source:desc&output=json`
    const res = await fetch(url, { headers: headers() })
    if (!res.ok) throw new Error(`Ahrefs ${res.status}`)
    const data = await res.json()
    const backlinks: AhrefsBrokenBacklink[] = (data.backlinks || data.broken_backlinks || []).map(
      (b: Record<string, unknown>) => ({
        url_from: String(b.url_from || ''),
        url_to: String(b.url_to || ''),
        domain_rating_source: Number(b.domain_rating_source || b.domain_rating || 0),
        http_code: Number(b.http_code || 0),
        first_seen: String(b.first_seen || ''),
      })
    )
    return realResponse(backlinks, source)
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<AhrefsBrokenBacklink[]>([], source)
  }
}

/** Ahrefs Refdomains History */
export async function fetchRefdomainsHistory(
  domain: string
): Promise<ApiResponse<AhrefsRefdomainsHistory[]>> {
  const source = 'ahrefs_refdomains_history'
  try {
    const url = `${AHREFS_API_BASE}/site-explorer/refdomains-history?target=${encodeURIComponent(domain)}&output=json`
    const res = await fetch(url, { headers: headers() })
    if (!res.ok) throw new Error(`Ahrefs ${res.status}`)
    const data = await res.json()
    const history: AhrefsRefdomainsHistory[] = (data.refdomains || data.history || []).map(
      (h: Record<string, unknown>) => ({
        date: String(h.date || ''),
        refdomains: Number(h.refdomains || h.value || 0),
      })
    )
    return realResponse(history, source)
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<AhrefsRefdomainsHistory[]>([], source)
  }
}
