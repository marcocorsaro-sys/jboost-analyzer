/**
 * Firecrawl client — JS-aware scraping for the MarTech LLM pipeline.
 *
 * Why this provider:
 *   The legacy MarTech pipeline (lib/martech/detect.ts) fetches HTML via the
 *   raw `https` module. Cloudflare-fronted commercial sites (e.g. casaforte.it)
 *   return a JS challenge page, leaving the detector with near-zero usable
 *   signals. Firecrawl renders the page in a headless browser and reliably
 *   bypasses these challenges.
 *
 * Endpoint: POST https://api.firecrawl.dev/v1/scrape
 * Auth    : Authorization: Bearer ${FIRECRAWL_API_KEY}
 * Pricing : 1 credit per scrape (~$0.0005 on the basic plan).
 *
 * Deliberately not extending BaseProviderClient — we mirror the lightweight
 * pattern of fetchDomainTechnologies(), which keeps the call paths inside
 * lib/martech/* free of Supabase service-role injection.
 */

const ENDPOINT = 'https://api.firecrawl.dev/v1/scrape'
const REQUEST_TIMEOUT_MS = 60_000

export type FirecrawlStatus =
  | 'ok'
  | 'no_credentials'
  | 'http_error'
  | 'invalid_response'
  | 'scrape_error'
  | 'network_error'

export interface FirecrawlScrapeResult {
  ok: boolean
  status: FirecrawlStatus
  /** Human-readable diagnostic when ok=false; passed through into MarTech report. */
  detail?: string
  /** Rendered HTML — what the user's browser would actually see. */
  html: string | null
  /** Markdown view of the page — useful for LLM context (often cleaner than HTML). */
  markdown: string | null
  /** Page metadata: title, description, OG tags, status code, source URL, …. */
  metadata: Record<string, unknown> | null
  /** Number of credits Firecrawl charged for this call (1 per scrape on basic). */
  credits_used: number
}

export interface FirecrawlScrapeOptions {
  /** Output formats to request. Default: ['html', 'markdown']. */
  formats?: Array<'html' | 'markdown' | 'rawHtml' | 'links' | 'screenshot'>
  /** Max page load wait in ms (Firecrawl-side). Default: 8000. */
  waitFor?: number
  /** Include only specific tags (advanced — rarely needed for our MarTech use). */
  includeTags?: string[]
  /** Exclude noisy tags (Firecrawl side). Default: ['script[type="application/json"]'] kept off so we keep JSON-LD signals. */
  excludeTags?: string[]
}

function readApiKey(): string | null {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key || key.length === 0) return null
  return key
}

/**
 * Scrape a single URL with Firecrawl. Always returns a `FirecrawlScrapeResult` —
 * never throws — so call sites can mirror DataForSEO's diagnostic-surfacing
 * pattern: ok=false rows become user-visible warnings instead of vanishing
 * console logs.
 */
export async function scrapeWithFirecrawl(
  url: string,
  opts: FirecrawlScrapeOptions = {},
): Promise<FirecrawlScrapeResult> {
  const apiKey = readApiKey()
  if (!apiKey) {
    return {
      ok: false,
      status: 'no_credentials',
      detail: 'FIRECRAWL_API_KEY not configured',
      html: null,
      markdown: null,
      metadata: null,
      credits_used: 0,
    }
  }

  const formats = opts.formats ?? ['html', 'markdown']
  const body = {
    url,
    formats,
    waitFor: opts.waitFor ?? 8000,
    ...(opts.includeTags ? { includeTags: opts.includeTags } : {}),
    ...(opts.excludeTags ? { excludeTags: opts.excludeTags } : {}),
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        ok: false,
        status: 'http_error',
        detail: `HTTP ${res.status}: ${text.slice(0, 250)}`,
        html: null,
        markdown: null,
        metadata: null,
        credits_used: 0,
      }
    }

    const json = (await res.json().catch(() => null)) as
      | {
          success?: boolean
          error?: string
          data?: {
            html?: string
            markdown?: string
            rawHtml?: string
            metadata?: Record<string, unknown>
          }
        }
      | null

    if (!json) {
      return {
        ok: false,
        status: 'invalid_response',
        detail: 'Firecrawl returned non-JSON body',
        html: null,
        markdown: null,
        metadata: null,
        credits_used: 0,
      }
    }

    if (json.success === false || !json.data) {
      return {
        ok: false,
        status: 'scrape_error',
        detail: json.error ?? 'Firecrawl reported success=false with no error message',
        html: null,
        markdown: null,
        metadata: null,
        credits_used: 0,
      }
    }

    return {
      ok: true,
      status: 'ok',
      html: json.data.html ?? json.data.rawHtml ?? null,
      markdown: json.data.markdown ?? null,
      metadata: json.data.metadata ?? null,
      credits_used: 1,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      status: 'network_error',
      detail: message,
      html: null,
      markdown: null,
      metadata: null,
      credits_used: 0,
    }
  } finally {
    clearTimeout(timer)
  }
}
