/**
 * Indexability Sanity — entrypoint del provider.
 *
 * Scopo: una "fotografia esterna" rapida di quanto un dominio è
 * effettivamente crawlabile + indicizzabile dai motori. Niente API key,
 * solo HTTP fetch. Riusa il `WappalyzerClient` per il fetch HTML, e fa
 * fetch diretto su `/robots.txt` e su sitemap dichiarate.
 *
 * Cosa controlla:
 *   1. robots.txt presente, con eventuale "Disallow: /" totale
 *   2. sitemap.xml dichiarata in robots.txt (o fallback /sitemap.xml)
 *   3. count URL totali nella sitemap
 *   4. homepage HTML: meta robots, canonical, hreflang
 *   5. produce uno score 0..100 + lista issue
 *
 * Use case: sezione "Indexability" del report Pre-Sales Health Check
 * + alimentazione del driver `Compliance` esistente (più segnali significa
 * meno falsi positivi nello score).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { WappalyzerClient } from '@/lib/integrations/providers/wappalyzer/client'
import { parseRobots, type RobotsParsed } from './robots'
import { parseSitemap, type SitemapParsed } from './sitemap'

export {
  parseRobots,
  type RobotsParsed,
  type RobotsRule,
  type RobotsUserAgentBlock,
} from './robots'
export {
  parseSitemap,
  type SitemapParsed,
} from './sitemap'

export interface IndexabilityIssue {
  severity: 'critical' | 'warning' | 'info'
  code: string
  message: string
}

export interface HtmlMetaSummary {
  /** Valore dell'attributo content del <meta name="robots">. */
  metaRobots: string | null
  /** True se contiene 'noindex' o 'none'. */
  isNoindex: boolean
  /** Canonical href dichiarato in <link rel="canonical">. */
  canonical: string | null
  /** Numero di <link rel="alternate" hreflang="..."> trovati. */
  hreflangCount: number
  /** Lingue hreflang dichiarate (lowercased). */
  hreflangLangs: string[]
}

export interface AuditIndexabilityArgs {
  supabase: SupabaseClient
  /** Dominio del cliente (con o senza http://). Usiamo www se ridiretto. */
  domain: string
  clientId?: string
  analysisId?: string
  userId?: string
}

export interface IndexabilityAuditSummary {
  ok: boolean
  finalUrl: string | null
  robots: RobotsParsed
  sitemap: SitemapParsed | null
  /** URL del sitemap.xml effettivamente analizzato. */
  sitemapUrlUsed: string | null
  homepage: HtmlMetaSummary | null
  issues: IndexabilityIssue[]
  /** Score 0..100 calcolato dalla presenza/correttezza dei segnali. */
  score: number
}

const SITEMAP_FALLBACKS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']

export async function auditIndexability(
  args: AuditIndexabilityArgs,
): Promise<IndexabilityAuditSummary> {
  const baseUrl = normalizeBaseUrl(args.domain)
  const issues: IndexabilityIssue[] = []
  const client = new WappalyzerClient({
    supabase: args.supabase,
    clientId: args.clientId,
    analysisId: args.analysisId,
    userId: args.userId,
  })

  // 1. robots.txt
  const robotsRaw = await fetchTextSafe(`${baseUrl}/robots.txt`)
  const robots = parseRobots(robotsRaw ?? '')
  if (!robots.found) {
    issues.push({
      severity: 'warning',
      code: 'no_robots_txt',
      message: 'robots.txt non trovata o vuota',
    })
  } else if (robots.blocksAllCrawl) {
    issues.push({
      severity: 'critical',
      code: 'robots_disallow_all',
      message: 'robots.txt blocca completamente i crawler con Disallow: /',
    })
  }

  // 2. sitemap.xml — usa la directive da robots.txt se presente, altrimenti
  // prova i fallback comuni.
  let sitemap: SitemapParsed | null = null
  let sitemapUrlUsed: string | null = null
  const candidates =
    robots.sitemaps.length > 0
      ? robots.sitemaps
      : SITEMAP_FALLBACKS.map((p) => `${baseUrl}${p}`)
  for (const url of candidates) {
    const raw = await fetchTextSafe(url)
    if (!raw) continue
    const parsed = parseSitemap(raw)
    if (parsed.found) {
      sitemap = parsed
      sitemapUrlUsed = url
      break
    }
  }
  if (!sitemap) {
    issues.push({
      severity: 'warning',
      code: 'no_sitemap',
      message: 'sitemap.xml non trovata né dichiarata in robots.txt',
    })
  } else if (sitemap.urlCount === 0) {
    issues.push({
      severity: 'warning',
      code: 'empty_sitemap',
      message: 'sitemap trovata ma non contiene <loc> URL',
    })
  }

  // 3. homepage meta tags
  const fetched = await client.fetchPage(args.domain)
  let homepage: HtmlMetaSummary | null = null
  let finalUrl: string | null = null
  if (fetched.ok && fetched.data) {
    finalUrl = fetched.data.finalUrl
    homepage = extractHtmlMeta(fetched.data.html)
    if (homepage.isNoindex) {
      issues.push({
        severity: 'critical',
        code: 'homepage_noindex',
        message: 'Homepage ha meta robots noindex — non sarà indicizzata',
      })
    }
    if (!homepage.canonical) {
      issues.push({
        severity: 'info',
        code: 'no_canonical',
        message: 'Homepage non dichiara <link rel="canonical">',
      })
    }
    if (homepage.hreflangCount === 0) {
      issues.push({
        severity: 'info',
        code: 'no_hreflang',
        message: 'Homepage non dichiara hreflang (OK se sito mono-lingua)',
      })
    }
  } else {
    issues.push({
      severity: 'critical',
      code: 'homepage_fetch_failed',
      message: `Impossibile scaricare la homepage: ${fetched.error ?? 'HTTP ' + fetched.status}`,
    })
  }

  return {
    ok: issues.filter((i) => i.severity === 'critical').length === 0,
    finalUrl,
    robots,
    sitemap,
    sitemapUrlUsed,
    homepage,
    issues,
    score: computeScore(robots, sitemap, homepage, issues),
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function normalizeBaseUrl(domain: string): string {
  if (domain.startsWith('http')) return domain.replace(/\/+$/, '')
  return `https://${domain}`.replace(/\/+$/, '')
}

async function fetchTextSafe(url: string, timeoutMs = 10_000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JBoostAnalyzer/1.0)',
        Accept: '*/*',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    clearTimeout(timer)
    return null
  }
}

function extractHtmlMeta(html: string): HtmlMetaSummary {
  // <meta name="robots" content="...">
  const robotsMatch = html.match(
    /<meta\s+[^>]*\bname\s*=\s*["']robots["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i,
  )
  const metaRobots = robotsMatch ? robotsMatch[1] : null
  const isNoindex = metaRobots != null && /\b(noindex|none)\b/i.test(metaRobots)

  // <link rel="canonical" href="...">
  const canonicalMatch = html.match(
    /<link\s+[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i,
  )
  const canonical = canonicalMatch ? canonicalMatch[1] : null

  // <link rel="alternate" hreflang="...">
  const hreflangRe = /<link\s+[^>]*\brel\s*=\s*["']alternate["'][^>]*\bhreflang\s*=\s*["']([^"']+)["']/gi
  const hreflangLangs: string[] = []
  let m: RegExpExecArray | null
  while ((m = hreflangRe.exec(html)) !== null) {
    hreflangLangs.push(m[1].toLowerCase())
  }

  return {
    metaRobots,
    isNoindex,
    canonical,
    hreflangCount: hreflangLangs.length,
    hreflangLangs,
  }
}

/**
 * Score 0..100 dell'indexability sanity. Cinque slot da 20 punti:
 *   - robots.txt presente e non-block → 20
 *   - sitemap dichiarata in robots.txt → 15 (5 bonus se anche valid e non-empty)
 *   - homepage indicizzabile (no noindex, fetched ok) → 25
 *   - canonical presente → 15
 *   - almeno un hreflang valido OPPURE sito mono-lingua dichiarato in HTML → 10
 *   - sitemap.urlCount > 10 → 15
 */
function computeScore(
  robots: RobotsParsed,
  sitemap: SitemapParsed | null,
  homepage: HtmlMetaSummary | null,
  issues: IndexabilityIssue[],
): number {
  let score = 0
  // robots.txt
  if (robots.found && !robots.blocksAllCrawl) score += 20
  // sitemap dichiarata + valid + non-empty
  if (sitemap?.found) {
    score += 15
    if (sitemap.urlCount > 10) score += 15
  }
  // homepage indicizzabile
  if (homepage && !homepage.isNoindex) score += 25
  // canonical
  if (homepage?.canonical) score += 15
  // hreflang almeno 1
  if (homepage && homepage.hreflangCount > 0) score += 10

  // Critical issues abbassano lo score di 30 punti per ognuna
  const criticalCount = issues.filter((i) => i.severity === 'critical').length
  score = Math.max(0, score - criticalCount * 30)

  return Math.min(100, score)
}
