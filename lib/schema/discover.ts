/**
 * Schema Radiography — URL discovery + sampling.
 *
 * Goal: pick ~30 URLs from a domain that maximize template diversity. We try
 * sitemap.xml first (cheap + authoritative), with a homepage-link fallback.
 * URLs are bucketed by inferred "page role" (homepage, product, article, faq,
 * category, blog, contact, ...) so the radiography sees every important
 * template shape rather than 30 product pages from the same template.
 */

import type { PageRole } from './rubrics'

export interface DiscoveredUrl {
  url: string
  role: PageRole
}

export const DEFAULT_SAMPLE_SIZE = 30

const SITEMAP_FETCH_TIMEOUT_MS = 15_000
const MAX_SITEMAP_BYTES = 5 * 1024 * 1024 // 5 MB cap per sitemap fetch
const MAX_NESTED_SITEMAPS = 8
const MAX_URLS_PER_SITEMAP = 5_000

/**
 * Heuristic URL-pattern → page role. Run on the path (no host). Order matters:
 * the first matching pattern wins.
 */
const ROLE_PATTERNS: Array<{ role: PageRole; re: RegExp }> = [
  { role: 'faq', re: /\b(faq|domande[-_ ]?frequenti|q[-_ ]?and[-_ ]?a)\b/i },
  { role: 'product', re: /\/(product|prodott[oi]|p)\//i },
  { role: 'product', re: /\/shop\//i },
  { role: 'category', re: /\/(category|categor[ia]|collezion[ei]|collection|range)\//i },
  { role: 'blog', re: /\/blog\//i },
  { role: 'news', re: /\/(news|press|comunicat[oi]|attualit[aà])\//i },
  { role: 'article', re: /\/(article|articol[oi])\//i },
  { role: 'about', re: /\/(about|chi[-_ ]?siamo|azienda|company|storia)\b/i },
  { role: 'contact', re: /\/(contact|contatt[oi]|customer[-_ ]?service)\b/i },
  { role: 'event', re: /\/(event|event[oi])\b/i },
  { role: 'recipe', re: /\/(recipe|ricett[ae])\b/i },
  { role: 'video', re: /\/(video|tv|watch)\b/i },
  { role: 'location', re: /\/(store|negoz[ioi]|sed[ei]|find[-_ ]?(a[-_ ]?)?store)\b/i },
]

/** Classify a single URL into one page role. */
export function classifyUrl(url: string, homepageOrigin: string): PageRole {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    if (path === '' || path === '/') return 'homepage'
    if (u.origin === homepageOrigin && (path === '' || path === '/')) return 'homepage'
    for (const { role, re } of ROLE_PATTERNS) {
      if (re.test(path)) return role
    }
    return 'other'
  } catch {
    return 'other'
  }
}

interface SitemapFetchOptions {
  /** AbortSignal to cancel the chain. */
  signal?: AbortSignal
}

async function fetchText(url: string, opts: SitemapFetchOptions = {}): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), SITEMAP_FETCH_TIMEOUT_MS)
  const signal = opts.signal
    ? mergeSignals([ctrl.signal, opts.signal])
    : ctrl.signal
  try {
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'JBoost-Schema-Radiography/1.0 (+https://jboost.dev)' },
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_SITEMAP_BYTES) return null
    return new TextDecoder('utf-8').decode(buf)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function mergeSignals(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController()
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort()
      break
    }
    s.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  return ctrl.signal
}

/** Pull <loc>…</loc> entries from a sitemap document. */
function parseSitemapLocs(xml: string): string[] {
  const out: string[] = []
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].trim())
    if (out.length >= MAX_URLS_PER_SITEMAP) break
  }
  return out
}

/** Detect whether a sitemap document is an index (points to sub-sitemaps). */
function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex\b/i.test(xml)
}

/**
 * Pull URLs from the domain's sitemap(s). Follows up to MAX_NESTED_SITEMAPS
 * children when the root is a sitemap index. Returns deduped URLs.
 */
export async function fetchSitemapUrls(
  homepageUrl: string,
  opts: SitemapFetchOptions = {},
): Promise<string[]> {
  const origin = new URL(homepageUrl).origin
  const seeds = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
  ]

  const seen = new Set<string>()
  const out: string[] = []

  for (const seed of seeds) {
    if (out.length > 0) break // first seed that yields URLs wins
    const xml = await fetchText(seed, opts)
    if (!xml) continue

    if (!isSitemapIndex(xml)) {
      for (const u of parseSitemapLocs(xml)) {
        if (!seen.has(u)) {
          seen.add(u)
          out.push(u)
        }
      }
      continue
    }

    // Sitemap index — walk children (capped).
    const childUrls = parseSitemapLocs(xml).slice(0, MAX_NESTED_SITEMAPS)
    for (const child of childUrls) {
      const childXml = await fetchText(child, opts)
      if (!childXml) continue
      for (const u of parseSitemapLocs(childXml)) {
        if (!seen.has(u)) {
          seen.add(u)
          out.push(u)
        }
      }
    }
  }

  return out
}

/**
 * Same-site check that treats `www.example.com` and `example.com` as the same
 * origin. Sitemaps very often list `https://www.X/...` even when the homepage
 * is reachable on `https://X/` (or vice versa); without this normalization,
 * the whole sitemap gets filtered out as off-site.
 */
function sameSite(a: URL, b: URL): boolean {
  if (a.protocol !== b.protocol) return false
  const stripWww = (h: string) => h.replace(/^www\./i, '')
  return stripWww(a.hostname.toLowerCase()) === stripWww(b.hostname.toLowerCase())
}

/**
 * Sample `target` URLs that maximize template diversity. Always pins the
 * homepage, then walks the role buckets round-robin so we hit every page type
 * before piling on duplicates of the largest bucket.
 */
export function sampleByRole(
  urls: string[],
  homepageUrl: string,
  target = DEFAULT_SAMPLE_SIZE,
): DiscoveredUrl[] {
  const homepageUrlObj = new URL(homepageUrl)
  const buckets = new Map<PageRole, string[]>()

  // Always seed the homepage bucket with the canonical homepage URL so it's
  // included even when the sitemap lists only sub-pages.
  buckets.set('homepage', [homepageUrl])

  for (const u of urls) {
    let parsed: URL
    try {
      parsed = new URL(u)
    } catch {
      continue
    }
    // Same-site only (apex + www. variants are accepted as one site).
    if (!sameSite(parsed, homepageUrlObj)) continue
    const role = classifyUrl(u, homepageUrlObj.origin)
    const arr = buckets.get(role) ?? []
    if (arr.includes(u)) continue
    arr.push(u)
    buckets.set(role, arr)
  }

  // Drain buckets round-robin so every represented role contributes before any
  // role gets a second pick.
  const ordering: PageRole[] = [
    'homepage', 'product', 'article', 'blog', 'news',
    'faq', 'category', 'about', 'contact', 'event',
    'recipe', 'video', 'location', 'other',
  ]
  const picked: DiscoveredUrl[] = []
  const cursor: Record<string, number> = {}
  while (picked.length < target) {
    let advanced = false
    for (const role of ordering) {
      const arr = buckets.get(role)
      if (!arr || arr.length === 0) continue
      const i = cursor[role] ?? 0
      if (i >= arr.length) continue
      picked.push({ url: arr[i], role })
      cursor[role] = i + 1
      advanced = true
      if (picked.length >= target) break
    }
    if (!advanced) break
  }
  return picked
}

/**
 * High-level: discover up to `target` URLs from a homepage. Tries sitemaps
 * first; returns the homepage on its own if everything else fails (so the
 * pipeline still produces a useful radiography even on tiny sites).
 */
export async function discoverUrls(
  homepageUrl: string,
  target = DEFAULT_SAMPLE_SIZE,
  opts: SitemapFetchOptions = {},
): Promise<{ urls: DiscoveredUrl[]; source: 'sitemap' | 'homepage_only'; sitemapSize: number }> {
  const sitemapUrls = await fetchSitemapUrls(homepageUrl, opts)
  if (sitemapUrls.length === 0) {
    return {
      urls: [{ url: homepageUrl, role: 'homepage' }],
      source: 'homepage_only',
      sitemapSize: 0,
    }
  }
  return {
    urls: sampleByRole(sitemapUrls, homepageUrl, target),
    source: 'sitemap',
    sitemapSize: sitemapUrls.length,
  }
}
