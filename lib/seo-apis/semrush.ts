import type {
  SemrushDomainOverview,
  SemrushKeywordLoss,
  SemrushBrandedKeywords,
  SemrushRankHistory,
  SemrushSiteHealth,
  SemrushSiteIssue,
  ApiResponse,
} from './types'

const SEMRUSH_API_BASE = 'https://api.semrush.com'

function getApiKey(): string {
  const key = process.env.SEMRUSH_API_KEY
  if (!key) throw new Error('SEMRUSH_API_KEY not configured')
  return key
}

/** Parse SEMrush semicolon-delimited CSV response into array of objects */
function parseSemrushCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(';')
  return lines.slice(1).map((line) => {
    const values = line.split(';')
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h.trim()] = (values[i] || '').trim()
    })
    return obj
  })
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

/** SEMrush Domain Overview — domain_rank endpoint */
export async function fetchDomainOverview(
  domain: string,
  country: string = 'us'
): Promise<ApiResponse<SemrushDomainOverview>> {
  const source = 'semrush_domain_overview'
  try {
    const url = `${SEMRUSH_API_BASE}/?type=domain_rank&key=${getApiKey()}&export_columns=Rk,Or,Ot,Oc,Ad,At,Ac&domain=${domain}&database=${country}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`SEMrush ${res.status}: ${await res.text()}`)
    const text = await res.text()
    const rows = parseSemrushCsv(text)
    if (rows.length === 0) {
      return mockResponse<SemrushDomainOverview>(
        { rank: 0, organicKeywords: 0, organicTraffic: 0, organicCost: 0, adwordsKeywords: 0, adwordsTraffic: 0, adwordsCost: 0 },
        source
      )
    }
    const r = rows[0]
    return realResponse<SemrushDomainOverview>(
      {
        rank: parseInt(r['Rk'] || '0', 10),
        organicKeywords: parseInt(r['Or'] || '0', 10),
        organicTraffic: parseInt(r['Ot'] || '0', 10),
        organicCost: parseFloat(r['Oc'] || '0'),
        adwordsKeywords: parseInt(r['Ad'] || '0', 10),
        adwordsTraffic: parseInt(r['At'] || '0', 10),
        adwordsCost: parseFloat(r['Ac'] || '0'),
      },
      source
    )
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<SemrushDomainOverview>(
      { rank: 0, organicKeywords: 0, organicTraffic: 0, organicCost: 0, adwordsKeywords: 0, adwordsTraffic: 0, adwordsCost: 0 },
      source
    )
  }
}

/** SEMrush Organic Keywords — top losing keywords */
export async function fetchOrganicLosing(
  domain: string,
  country: string = 'us'
): Promise<ApiResponse<SemrushKeywordLoss[]>> {
  const source = 'semrush_organic_losing'
  try {
    const url = `${SEMRUSH_API_BASE}/?type=domain_organic&key=${getApiKey()}&export_columns=Ph,Po,Pp,Pd,Tr,Nq&domain=${domain}&database=${country}&display_sort=tr_desc&display_filter=%2B%7CPd%7CLt%7C0&display_limit=20`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`SEMrush ${res.status}`)
    const text = await res.text()
    const rows = parseSemrushCsv(text)
    const keywords: SemrushKeywordLoss[] = rows.map((r) => ({
      keyword: r['Ph'] || '',
      position: parseInt(r['Po'] || '0', 10),
      previousPosition: parseInt(r['Pp'] || '0', 10),
      positionDifference: parseInt(r['Pd'] || '0', 10),
      traffic: parseFloat(r['Tr'] || '0'),
      searchVolume: parseInt(r['Nq'] || '0', 10),
    }))
    return realResponse(keywords, source)
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<SemrushKeywordLoss[]>([], source)
  }
}

/** SEMrush Branded Keywords */
export async function fetchBrandedKeywords(
  domain: string,
  brand: string,
  country: string = 'us'
): Promise<ApiResponse<SemrushBrandedKeywords>> {
  const source = 'semrush_branded_keywords'
  try {
    const encodedBrand = encodeURIComponent(brand)
    const url = `${SEMRUSH_API_BASE}/?type=domain_organic&key=${getApiKey()}&export_columns=Ph,Tr&domain=${domain}&database=${country}&display_filter=%2B%7CPh%7CCo%7C${encodedBrand}&display_limit=100`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`SEMrush ${res.status}`)
    const text = await res.text()
    const rows = parseSemrushCsv(text)
    const count = rows.length
    const totalBrandedTraffic = rows.reduce((sum, r) => sum + parseFloat(r['Tr'] || '0'), 0)
    return realResponse({ count, totalBrandedTraffic }, source)
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse({ count: 0, totalBrandedTraffic: 0 }, source)
  }
}

/** SEMrush Brand Awareness — domain_rank_history */
export async function fetchBrandAwareness(
  domain: string,
  country: string = 'us'
): Promise<ApiResponse<SemrushRankHistory[]>> {
  const source = 'semrush_brand_awareness'
  try {
    const url = `${SEMRUSH_API_BASE}/?type=domain_rank_history&key=${getApiKey()}&export_columns=Dt,Rk,Or,Ot&domain=${domain}&database=${country}&display_limit=12`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`SEMrush ${res.status}`)
    const text = await res.text()
    const rows = parseSemrushCsv(text)
    const history: SemrushRankHistory[] = rows.map((r) => ({
      date: r['Dt'] || '',
      rank: parseInt(r['Rk'] || '0', 10),
      organicKeywords: parseInt(r['Or'] || '0', 10),
      organicTraffic: parseInt(r['Ot'] || '0', 10),
    }))
    return realResponse(history, source)
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<SemrushRankHistory[]>([], source)
  }
}

/** SEMrush Site Health — Site Audit Management API */
export async function fetchSiteHealth(
  domain: string
): Promise<ApiResponse<SemrushSiteHealth>> {
  const source = 'semrush_site_health'
  try {
    // Step 1: List projects to find the one matching this domain
    const listUrl = `https://api.semrush.com/management/v1/projects?key=${getApiKey()}`
    const listRes = await fetch(listUrl)
    if (!listRes.ok) throw new Error(`SEMrush projects ${listRes.status}`)
    const projects = await listRes.json()

    const project = projects.find((p: { project_url: string; project_id: number }) =>
      p.project_url?.includes(domain)
    )

    if (!project) {
      console.warn(`[${source}] No SEMrush project found for domain: ${domain}`)
      return mockResponse<SemrushSiteHealth>(
        { site_health_score: null, issues: [], pages_crawled: 0 },
        source
      )
    }

    // Step 2: Get latest audit snapshot
    const auditUrl = `https://api.semrush.com/management/v1/projects/${project.project_id}/siteaudit/info?key=${getApiKey()}`
    const auditRes = await fetch(auditUrl)
    if (!auditRes.ok) throw new Error(`SEMrush audit ${auditRes.status}`)
    const audit = await auditRes.json()

    const healthScore = audit.quality?.value ?? audit.site_health_score ?? null
    const pagesCrawled = audit.pages_crawled ?? audit.checked_pages ?? 0

    // Step 3: Get issues
    const issuesUrl = `https://api.semrush.com/management/v1/projects/${project.project_id}/siteaudit/issues?key=${getApiKey()}&limit=50`
    const issuesRes = await fetch(issuesUrl)
    let issues: SemrushSiteIssue[] = []
    if (issuesRes.ok) {
      const issuesData = await issuesRes.json()
      issues = (issuesData.issues || issuesData || []).map((i: Record<string, unknown>) => ({
        id: String(i.id || ''),
        title: String(i.title || i.name || ''),
        type: String(i.type || i.severity || 'warning') as SemrushSiteIssue['type'],
        pages_count: Number(i.pages_count || i.count || 0),
      }))
    }

    return realResponse<SemrushSiteHealth>(
      { site_health_score: healthScore, issues, pages_crawled: pagesCrawled },
      source
    )
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<SemrushSiteHealth>(
      { site_health_score: null, issues: [], pages_crawled: 0 },
      source
    )
  }
}
