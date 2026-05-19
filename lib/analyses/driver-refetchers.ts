// Driver-aware live re-fetchers — called by the per-driver rerun endpoint
// so that "Rilancia driver" actually pulls fresh external data instead of
// reusing the (possibly stale or mock) api_data persisted from the original
// analysis run. Implementations mirror the ones in run-analysis.ts; we keep
// the parallel copy to avoid a risky cross-file refactor.
//
// Each refetcher returns the same { data, _meta } envelope that run-analysis
// persists, so the rerun route can drop the result straight into the
// driverInputs map with no extra unwrapping.

interface Wrapped<T> { data: T; _meta: { is_mock: boolean } }

export interface DriverRefetchKeys {
  semrushKey: string
  ahrefsKey: string
  psiKey: string
  dataforseoLogin: string
  dataforseoPassword: string
}

const SEMRUSH = 'https://api.semrush.com'
const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function parseSemrushCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(';')
  return lines.slice(1).map(line => {
    const values = line.split(';')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i] ?? '' })
    return row
  })
}

export async function refetchSemrushDomainRank(domain: string, country: string, apiKey: string): Promise<Wrapped<Record<string, unknown>>> {
  if (!apiKey) return { data: {}, _meta: { is_mock: true } }
  try {
    const url = `${SEMRUSH}/?type=domain_rank&key=${apiKey}&export_columns=Rk,Or,Ot,Oc,Ad,At,Ac&domain=${domain}&database=${country}`
    const res = await fetchWithTimeout(url, { timeoutMs: 25_000 })
    if (!res.ok) throw new Error(`${res.status}`)
    const rows = parseSemrushCsv(await res.text())
    return { data: rows[0] ?? {}, _meta: { is_mock: false } }
  } catch (e) {
    console.warn('[refetch:semrush_domain_rank]', (e as Error).message)
    return { data: {}, _meta: { is_mock: true } }
  }
}

export async function refetchSemrushSiteHealth(domain: string, apiKey: string): Promise<Wrapped<Record<string, unknown>>> {
  if (!apiKey) return { data: { site_health_score: null, issues: [], pages_crawled: 0 }, _meta: { is_mock: true } }
  try {
    const listRes = await fetchWithTimeout(`${SEMRUSH}/management/v1/projects?key=${apiKey}`, { timeoutMs: 25_000 })
    if (!listRes.ok) throw new Error(`projects ${listRes.status}`)
    const projects = await listRes.json()
    const project = (projects as Array<{ project_id: string; project_url?: string }>).find(p => p.project_url?.includes(domain))
    if (!project) return { data: { site_health_score: null, issues: [], pages_crawled: 0 }, _meta: { is_mock: true } }
    const auditRes = await fetchWithTimeout(`${SEMRUSH}/management/v1/projects/${project.project_id}/siteaudit/info?key=${apiKey}`, { timeoutMs: 25_000 })
    if (!auditRes.ok) throw new Error(`audit ${auditRes.status}`)
    const audit = await auditRes.json() as { quality?: { value: number }; site_health_score?: number; pages_crawled?: number; checked_pages?: number }
    const issuesRes = await fetchWithTimeout(`${SEMRUSH}/management/v1/projects/${project.project_id}/siteaudit/issues?key=${apiKey}&limit=50`, { timeoutMs: 25_000 })
    let siteIssues: Array<Record<string, unknown>> = []
    if (issuesRes.ok) {
      const d = await issuesRes.json() as { issues?: Array<Record<string, unknown>> }
      siteIssues = (d.issues || []).map(i => ({
        id: String(i.id ?? ''),
        title: String(i.title ?? i.name ?? ''),
        type: String(i.type ?? i.severity ?? 'warning'),
        pages_count: Number(i.pages_count ?? i.count ?? 0),
      }))
    }
    return {
      data: {
        site_health_score: audit.quality?.value ?? audit.site_health_score ?? null,
        issues: siteIssues,
        pages_crawled: audit.pages_crawled ?? audit.checked_pages ?? 0,
      },
      _meta: { is_mock: false },
    }
  } catch (e) {
    console.warn('[refetch:semrush_site_health]', (e as Error).message)
    return { data: { site_health_score: null, issues: [], pages_crawled: 0 }, _meta: { is_mock: true } }
  }
}

export async function refetchSemrushBrandAwareness(domain: string, country: string, apiKey: string): Promise<Wrapped<Record<string, unknown>>> {
  if (!apiKey) return { data: { latestRank: 0, average: 0, latest: 0 }, _meta: { is_mock: true } }
  try {
    const url = `${SEMRUSH}/?type=domain_rank_history&key=${apiKey}&export_columns=Dt,Rk,Or,Ot&domain=${domain}&database=${country}&display_limit=12`
    const res = await fetchWithTimeout(url, { timeoutMs: 25_000 })
    if (!res.ok) throw new Error(`${res.status}`)
    const rows = parseSemrushCsv(await res.text())
    const latest = rows[0] ?? {}
    const traffics = rows.map(r => parseFloat(r['Organic Traffic'] || r['Ot'] || '0')).filter(t => t > 0)
    const average = traffics.length ? traffics.reduce((a, b) => a + b, 0) / traffics.length : 0
    return {
      data: {
        latestRank: parseInt(latest['Rank'] || latest['Rk'] || '0'),
        average,
        latest: parseFloat(latest['Organic Traffic'] || latest['Ot'] || '0'),
      },
      _meta: { is_mock: false },
    }
  } catch (e) {
    console.warn('[refetch:semrush_brand_awareness]', (e as Error).message)
    return { data: { latestRank: 0, average: 0, latest: 0 }, _meta: { is_mock: true } }
  }
}

export async function refetchAhrefsDomainRating(domain: string, apiKey: string): Promise<Wrapped<Record<string, unknown>>> {
  if (!apiKey) return { data: { domain_rating: null }, _meta: { is_mock: true } }
  try {
    const url = `https://api.ahrefs.com/v3/site-explorer/domain-rating?target=${domain}&mode=domain&date=${new Date().toISOString().slice(0, 10)}`
    const res = await fetchWithTimeout(url, {
      timeoutMs: 25_000,
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json() as { domain_rating?: { domain_rating: number; ahrefs_rank?: number } }
    return {
      data: {
        domain_rating: data.domain_rating?.domain_rating ?? null,
        ahrefs_rank: data.domain_rating?.ahrefs_rank,
      },
      _meta: { is_mock: false },
    }
  } catch (e) {
    console.warn('[refetch:ahrefs_domain_rating]', (e as Error).message)
    return { data: { domain_rating: null }, _meta: { is_mock: true } }
  }
}

export async function refetchAhrefsAiRelevance(domain: string, country: string, apiKey: string): Promise<Wrapped<Record<string, unknown>>> {
  if (!apiKey) return { data: { ai_relevance_score: 0, ai_overview_keywords: 0, featured_snippet_keywords: 0, total_keywords: 0 }, _meta: { is_mock: true } }
  try {
    const url = `https://api.ahrefs.com/v3/site-explorer/organic-keywords?target=${domain}&country=${country.toLowerCase()}&select=keyword,volume,serp_features&limit=200`
    const res = await fetchWithTimeout(url, {
      timeoutMs: 25_000,
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json() as { organic_keywords?: Array<{ keyword: string; volume: number; serp_features: string[] }> }
    const kws = data.organic_keywords ?? []
    const ai = kws.filter(k => k.serp_features?.includes('ai_overview') || k.serp_features?.includes('ai_overviews')).length
    const fs = kws.filter(k => k.serp_features?.includes('featured_snippet')).length
    const score = kws.length > 0 ? ((ai + fs) / kws.length) * 100 : 0
    return {
      data: {
        ai_relevance_score: score,
        ai_overview_keywords: ai,
        featured_snippet_keywords: fs,
        total_keywords: kws.length,
      },
      _meta: { is_mock: false },
    }
  } catch (e) {
    console.warn('[refetch:ahrefs_ai_relevance]', (e as Error).message)
    return { data: { ai_relevance_score: 0, ai_overview_keywords: 0, featured_snippet_keywords: 0, total_keywords: 0 }, _meta: { is_mock: true } }
  }
}

export async function refetchPageSpeedMobile(domain: string, apiKey: string): Promise<Wrapped<Record<string, unknown>>> {
  if (!apiKey) return { data: { performance_score: 0, accessibility_score: 0, seo_score: 0, best_practices_score: 0 }, _meta: { is_mock: true } }
  try {
    const url = `${PSI}?url=https://${domain}&key=${apiKey}&strategy=mobile&category=performance&category=accessibility&category=seo&category=best-practices`
    const res = await fetchWithTimeout(url, { timeoutMs: 45_000 })
    if (!res.ok) throw new Error(`${res.status}`)
    const d = await res.json() as { lighthouseResult?: { categories?: Record<string, { score?: number }> } }
    const cats = d.lighthouseResult?.categories ?? {}
    return {
      data: {
        performance_score: Math.round((cats.performance?.score ?? 0) * 100),
        accessibility_score: Math.round((cats.accessibility?.score ?? 0) * 100),
        seo_score: Math.round((cats.seo?.score ?? 0) * 100),
        best_practices_score: Math.round((cats['best-practices']?.score ?? 0) * 100),
      },
      _meta: { is_mock: false },
    }
  } catch (e) {
    console.warn('[refetch:pagespeed_mobile]', (e as Error).message)
    return { data: { performance_score: 0, accessibility_score: 0, seo_score: 0, best_practices_score: 0 }, _meta: { is_mock: true } }
  }
}

/**
 * High-level: given a driver name, fetch the data sources it needs and
 * return them in the shape buildAgentInputs() expects. Skips fetchers
 * the driver doesn't need.
 *
 * Each fetcher individually times out + soft-degrades to mock, so this
 * function never throws.
 */
export async function refetchForDriver(
  driverName: string,
  ctx: { domain: string; country: string },
  keys: Partial<DriverRefetchKeys>,
): Promise<Record<string, Record<string, unknown> | null>> {
  const country = (ctx.country || 'us').toLowerCase()
  const out: Record<string, Record<string, unknown> | null> = {}

  const collectSemrushDomain = async () => {
    const r = await refetchSemrushDomainRank(ctx.domain, country, keys.semrushKey ?? '')
    out.semrush_domain_overview = r.data
  }
  const collectSemrushSiteHealth = async () => {
    const r = await refetchSemrushSiteHealth(ctx.domain, keys.semrushKey ?? '')
    out.semrush_site_health = r.data
  }
  const collectPsi = async () => {
    const r = await refetchPageSpeedMobile(ctx.domain, keys.psiKey ?? '')
    out.pagespeed_mobile = r.data
  }
  const collectAhrefsDr = async () => {
    const r = await refetchAhrefsDomainRating(ctx.domain, keys.ahrefsKey ?? '')
    out.ahrefs_domain_rating = r.data
  }
  const collectAhrefsAi = async () => {
    const r = await refetchAhrefsAiRelevance(ctx.domain, country, keys.ahrefsKey ?? '')
    out.ahrefs_ai_relevance = r.data
  }
  const collectBrandAwareness = async () => {
    const r = await refetchSemrushBrandAwareness(ctx.domain, country, keys.semrushKey ?? '')
    out.semrush_brand_awareness = r.data
  }

  const plan: Record<string, Array<() => Promise<void>>> = {
    compliance: [collectSemrushSiteHealth, collectPsi],
    experience: [collectPsi],
    accessibility: [collectPsi],
    content: [collectSemrushSiteHealth, collectPsi, collectSemrushDomain],
    discoverability: [collectSemrushDomain],
    aso_visibility: [collectSemrushDomain],
    authority: [collectAhrefsDr],
    ai_relevance: [collectAhrefsAi],
    awareness: [collectBrandAwareness],
  }
  const tasks = plan[driverName] ?? []
  await Promise.allSettled(tasks.map(fn => fn()))
  return out
}
