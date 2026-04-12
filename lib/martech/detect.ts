import https from 'https'
import http from 'http'

/* ── Types ── */
export interface DetectedTool {
  category: string
  tool_name: string
  tool_version: string | null
  confidence: number
  details: Record<string, unknown> | null
}

export interface DetectionUsage {
  input_tokens: number
  output_tokens: number
}

export interface GapItem {
  category: string
  label: string
  severity: 'high' | 'medium' | 'low'
  description: string
}

export interface Recommendation {
  priority: number // 1-5
  title: string
  description: string
  category: string
}

export interface CompletenessReport {
  score: number                 // 0-100
  level: 'complete' | 'good' | 'partial' | 'incomplete'
  pagesScanned: number
  totalSignals: number
  diagnostics: Array<{
    type: 'success' | 'warning' | 'error' | 'info'
    message: string
  }>
  signalQuality: {
    scripts: number
    links: number
    metas: number
    htmlSize: number
    jsonLd: number
    preconnects: number
    noscripts: number
    iframes: number
    dataAttributes: number
  }
}

export interface DetectionResult {
  tools: DetectedTool[]
  usage: DetectionUsage
  completeness: CompletenessReport
  maturityScore: number
  maturityTier: 'Basic' | 'Developing' | 'Advanced' | 'Best-in-Class'
  gapAnalysis: GapItem[]
  recommendations: Recommendation[]
}

/* ── Normalize domain ── */
function normalizeDomain(raw: string): string {
  let d = raw.trim()
  d = d.replace(/^https?:\/\//, '')
  d = d.replace(/\/+$/, '')
  d = d.split('/')[0] // only the host
  return d
}

/* ── Fetch HTML via http/https module (handles SSL issues + redirects) ── */
function fetchHTML(
  url: string,
  rejectUnauthorized = true,
  maxRedirects = 5
): Promise<{ html: string; headers: Record<string, string>; statusCode: number; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'))
      return
    }

    const isHttps = url.startsWith('https')
    const lib = isHttps ? https : http

    const timeout = setTimeout(() => {
      req.destroy()
      reject(new Error('timeout'))
    }, 25000)

    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,it;q=0.8',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
      ...(isHttps ? { rejectUnauthorized } : {}),
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout)
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString()
        resolve(fetchHTML(redirectUrl, rejectUnauthorized, maxRedirects - 1))
        res.resume()
        return
      }

      const chunks: Buffer[] = []
      let totalSize = 0
      const MAX_SIZE = 5 * 1024 * 1024 // 5MB limit

      res.on('data', (chunk: Buffer) => {
        totalSize += chunk.length
        if (totalSize <= MAX_SIZE) {
          chunks.push(chunk)
        }
      })
      res.on('end', () => {
        clearTimeout(timeout)
        const html = Buffer.concat(chunks).toString('utf-8')
        const headers: Record<string, string> = {}
        for (const [key, val] of Object.entries(res.headers)) {
          if (val) headers[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val
        }
        resolve({ html, headers, statusCode: res.statusCode || 200, finalUrl: url })
      })
      res.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    req.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

/* ── Safe fetch with SSL fallback ── */
async function safeFetch(url: string): Promise<{ html: string; headers: Record<string, string>; statusCode: number; finalUrl: string }> {
  try {
    return await fetchHTML(url, true)
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr)
    const isSSL = msg.includes('certificate') || msg.includes('CERT') || msg.includes('SSL') || msg.includes('unable to verify')

    if (isSSL) {
      console.warn(`[MarTech] SSL error for ${url}, retrying without strict verification...`)
      return await fetchHTML(url, false)
    }
    throw firstErr
  }
}

/* ── Extract internal links from HTML for multi-page crawl ── */
function extractInternalLinks(html: string, domain: string): string[] {
  const linkRegex = /href=["'](\/[^"'\s#?][^"'\s]*?)["']/gi
  const found = new Set<string>()
  let match

  while ((match = linkRegex.exec(html)) !== null) {
    const path = match[1]
    if (path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|xml|json|mp4|webm)$/i)) continue
    if (path.startsWith('/_') || path.startsWith('/api/') || path.startsWith('/wp-admin')) continue
    found.add(path)
  }

  const absRegex = new RegExp(`href=["'](https?://${domain.replace(/\./g, '\\.')}(/[^"'\\s]*?))["']`, 'gi')
  while ((match = absRegex.exec(html)) !== null) {
    const path = match[2] || '/'
    if (!path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|xml|json)$/i)) {
      found.add(path)
    }
  }

  return Array.from(found)
}

/* ── Pick best subpages to crawl ── */
function pickSubpages(links: string[]): string[] {
  const priorityPatterns = [
    /^\/(en|it|es|fr|de)\/?$/i,
    /\/products?\//i,
    /\/shop\/?/i,
    /\/blog\/?/i,
    /\/about/i,
    /\/contact/i,
    /\/cart/i,
    /\/checkout/i,
    /\/account/i,
    /\/login/i,
    /\/privacy|\/cookie/i,
    /\/news\/?/i,
    /\/collection/i,
    /\/category/i,
  ]

  const prioritized: string[] = []
  const rest: string[] = []

  for (const link of links) {
    if (priorityPatterns.some(p => p.test(link))) {
      prioritized.push(link)
    } else if (link.split('/').filter(Boolean).length <= 2) {
      rest.push(link)
    }
  }

  const result = prioritized.slice(0, 3)
  if (result.length < 4 && rest.length > 0) {
    result.push(rest[Math.floor(Math.random() * rest.length)])
  }
  return result.slice(0, 4)
}

/* ── Signal extraction from a single HTML page ── */
interface PageSignals {
  scripts: string[]
  links: string[]
  metas: string[]
  headers: Record<string, string>
  headHtml: string
  bodySnippet: string
  jsonLd: string[]
  preconnects: string[]
  noscripts: string[]
  iframes: string[]
  dataAttributes: string[]
  htmlComments: string[]
  cookieHeaders: string[]
}

function extractSignalsFromHTML(html: string, headers: Record<string, string>): PageSignals {
  let match: RegExpExecArray | null

  // Scripts (src)
  const scriptSrcRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi
  const scripts: string[] = []
  while ((match = scriptSrcRegex.exec(html)) !== null) {
    scripts.push(match[1])
  }

  // Inline scripts — LARGER capture (500 chars)
  const inlineScriptRegex = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi
  while ((match = inlineScriptRegex.exec(html)) !== null) {
    const content = match[1].trim()
    if (content.length < 15) continue
    if (match[0].includes(' src=')) continue
    const snippet = content.slice(0, 500)
    scripts.push(`[inline] ${snippet}`)
  }

  // Links
  const linkRegex = /<link[^>]+href=["']([^"']+)["'][^>]*>/gi
  const links: string[] = []
  while ((match = linkRegex.exec(html)) !== null) {
    links.push(match[1])
  }

  // Metas
  const metaRegex = /<meta[^>]+>/gi
  const metas: string[] = []
  while ((match = metaRegex.exec(html)) !== null) {
    metas.push(match[0])
  }

  // JSON-LD
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const jsonLdBlocks: string[] = []
  while ((match = jsonLdRegex.exec(html)) !== null) {
    jsonLdBlocks.push(match[1].trim().slice(0, 1000))
  }

  // Preconnect/DNS-prefetch/preload
  const preconnectRegex = /<link[^>]+rel=["'](?:preconnect|dns-prefetch|preload)["'][^>]+href=["']([^"']+)["'][^>]*>/gi
  const preconnects: string[] = []
  while ((match = preconnectRegex.exec(html)) !== null) {
    preconnects.push(match[1])
  }

  // Noscript content
  const noscriptRegex = /<noscript[^>]*>([\s\S]*?)<\/noscript>/gi
  const noscriptContent: string[] = []
  while ((match = noscriptRegex.exec(html)) !== null) {
    const content = match[1].trim().slice(0, 300)
    if (content.length > 5) noscriptContent.push(content)
  }

  // Iframes
  const iframeRegex = /<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi
  const iframes: string[] = []
  while ((match = iframeRegex.exec(html)) !== null) {
    iframes.push(match[1])
  }

  // Data attributes
  const dataAttrRegex = /\s(data-[a-z][\w-]*|ng-[a-z]+|v-[a-z]+|x-[a-z]+)(?:=["'][^"']*["'])?/gi
  const dataAttributes = new Set<string>()
  while ((match = dataAttrRegex.exec(html)) !== null) {
    dataAttributes.add(match[1].toLowerCase())
  }

  // HTML comments
  const commentRegex = /<!--\s*([\s\S]*?)\s*-->/gi
  const htmlComments: string[] = []
  while ((match = commentRegex.exec(html)) !== null) {
    const comment = match[1].trim().slice(0, 200)
    if (comment.length > 5 && !comment.startsWith('[if ')) {
      htmlComments.push(comment)
    }
  }

  // Cookie headers
  const cookieHeaders: string[] = []
  const setCookie = headers['set-cookie']
  if (setCookie) {
    cookieHeaders.push(...setCookie.split(',').map(c => c.trim().split(';')[0]).filter(Boolean))
  }

  // Head + Body snippet
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
  const headHtml = headMatch ? headMatch[1].slice(0, 12000) : ''

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  let bodySnippet = ''
  if (bodyMatch) {
    const body = bodyMatch[1]
    const start = body.slice(0, 10000)
    const end = body.length > 15000 ? '\n[...BODY_MIDDLE_TRUNCATED...]\n' + body.slice(-5000) : ''
    bodySnippet = start + end
  }

  return {
    scripts: scripts.slice(0, 200),
    links: links.slice(0, 100),
    metas: metas.slice(0, 80),
    headers,
    headHtml,
    bodySnippet,
    jsonLd: jsonLdBlocks.slice(0, 15),
    preconnects: Array.from(new Set(preconnects)).slice(0, 40),
    noscripts: noscriptContent.slice(0, 20),
    iframes: iframes.slice(0, 20),
    dataAttributes: Array.from(dataAttributes).slice(0, 50),
    htmlComments: htmlComments.slice(0, 15),
    cookieHeaders: cookieHeaders.slice(0, 20),
  }
}

/* ── Multi-page signal aggregation ── */
interface AggregatedSignals {
  scripts: string[]
  links: string[]
  metas: string[]
  headers: Record<string, string>
  headHtml: string
  bodySnippet: string
  jsonLd: string[]
  preconnects: string[]
  noscripts: string[]
  iframes: string[]
  dataAttributes: string[]
  htmlComments: string[]
  cookieHeaders: string[]
  pagesScanned: number
  pagesFailed: string[]
  totalHtmlSize: number
}

async function fetchMultiPageSignals(domain: string): Promise<AggregatedSignals> {
  const cleanDomain = normalizeDomain(domain)
  const baseUrl = `https://${cleanDomain}`

  console.log(`[MarTech] Fetching homepage: ${baseUrl}`)

  let homeResult: Awaited<ReturnType<typeof safeFetch>>
  try {
    homeResult = await safeFetch(baseUrl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('timeout')) {
      throw new Error(`Timeout fetching ${cleanDomain} (25s). The site may be slow or unreachable.`)
    }
    throw new Error(`Cannot reach ${cleanDomain}: ${msg}`)
  }

  if (homeResult.statusCode >= 400) {
    console.warn(`[MarTech] HTTP ${homeResult.statusCode} for homepage`)
  }

  const homeSignals = extractSignalsFromHTML(homeResult.html, homeResult.headers)
  const totalHtmlSize = homeResult.html.length

  const internalLinks = extractInternalLinks(homeResult.html, cleanDomain)
  const subpages = pickSubpages(internalLinks)
  console.log(`[MarTech] Found ${internalLinks.length} internal links, will crawl ${subpages.length} subpages: ${subpages.join(', ')}`)

  const subpageResults: { path: string; signals: PageSignals; htmlSize: number }[] = []
  const pagesFailed: string[] = []

  if (subpages.length > 0) {
    const subpagePromises = subpages.map(async (path) => {
      const pageUrl = `${baseUrl}${path}`
      try {
        const result = await safeFetch(pageUrl)
        if (result.statusCode < 400) {
          return { path, signals: extractSignalsFromHTML(result.html, result.headers), htmlSize: result.html.length }
        } else {
          pagesFailed.push(`${path} (HTTP ${result.statusCode})`)
          return null
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        pagesFailed.push(`${path} (${msg.slice(0, 50)})`)
        return null
      }
    })

    const results = await Promise.allSettled(subpagePromises)
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        subpageResults.push(r.value)
      }
    }
  }

  // Merge signals
  const allSignals: PageSignals[] = [homeSignals, ...subpageResults.map(r => r.signals)]

  const mergedScripts = new Set<string>()
  const mergedLinks = new Set<string>()
  const mergedMetas = new Set<string>()
  const mergedJsonLd = new Set<string>()
  const mergedPreconnects = new Set<string>()
  const mergedNoscripts = new Set<string>()
  const mergedIframes = new Set<string>()
  const mergedDataAttrs = new Set<string>()
  const mergedComments = new Set<string>()
  const mergedCookies = new Set<string>()

  const mergedHeaders = { ...homeSignals.headers }

  for (const sig of allSignals) {
    sig.scripts.forEach(s => mergedScripts.add(s))
    sig.links.forEach(l => mergedLinks.add(l))
    sig.metas.forEach(m => mergedMetas.add(m))
    sig.jsonLd.forEach(j => mergedJsonLd.add(j))
    sig.preconnects.forEach(p => mergedPreconnects.add(p))
    sig.noscripts.forEach(n => mergedNoscripts.add(n))
    sig.iframes.forEach(i => mergedIframes.add(i))
    sig.dataAttributes.forEach(d => mergedDataAttrs.add(d))
    sig.htmlComments.forEach(c => mergedComments.add(c))
    sig.cookieHeaders.forEach(c => mergedCookies.add(c))

    for (const [k, v] of Object.entries(sig.headers)) {
      if (!mergedHeaders[k]) mergedHeaders[k] = v
    }
  }

  let combinedBodySnippet = `[HOMEPAGE BODY]\n${homeSignals.bodySnippet}`
  for (const sub of subpageResults) {
    combinedBodySnippet += `\n\n[SUBPAGE: ${sub.path}]\n${sub.signals.bodySnippet}`
  }

  const combinedTotalHtml = totalHtmlSize + subpageResults.reduce((s, r) => s + r.htmlSize, 0)

  return {
    scripts: Array.from(mergedScripts).slice(0, 300),
    links: Array.from(mergedLinks).slice(0, 150),
    metas: Array.from(mergedMetas).slice(0, 100),
    headers: mergedHeaders,
    headHtml: homeSignals.headHtml,
    bodySnippet: combinedBodySnippet.slice(0, 25000),
    jsonLd: Array.from(mergedJsonLd).slice(0, 20),
    preconnects: Array.from(mergedPreconnects).slice(0, 50),
    noscripts: Array.from(mergedNoscripts).slice(0, 30),
    iframes: Array.from(mergedIframes).slice(0, 25),
    dataAttributes: Array.from(mergedDataAttrs).slice(0, 60),
    htmlComments: Array.from(mergedComments).slice(0, 20),
    cookieHeaders: Array.from(mergedCookies).slice(0, 30),
    pagesScanned: 1 + subpageResults.length,
    pagesFailed,
    totalHtmlSize: combinedTotalHtml,
  }
}

/* ── Bot Challenge / WAF Detection ── */
function detectBotChallenge(html: string, headers: Record<string, string>): { isChallenge: boolean; provider: string | null } {
  if (headers['cf-ray'] && (
    html.includes('Just a moment...') ||
    html.includes('Checking your browser') ||
    html.includes('challenge-platform') ||
    html.includes('cf-browser-verification') ||
    html.includes('__cf_chl_') ||
    (html.length < 5000 && html.includes('cloudflare'))
  )) {
    return { isChallenge: true, provider: 'Cloudflare' }
  }

  if (html.includes('akam-sw.js') || html.includes('_abck') ||
    (html.length < 3000 && headers['server']?.includes('AkamaiGHost'))) {
    return { isChallenge: true, provider: 'Akamai Bot Manager' }
  }

  if (headers['x-iinfo'] || (html.includes('incapsula') && html.length < 5000)) {
    return { isChallenge: true, provider: 'Imperva/Incapsula' }
  }

  if (html.includes('_pxhd') || html.includes('perimeterx.net')) {
    return { isChallenge: true, provider: 'PerimeterX' }
  }

  if (html.includes('datadome.co') || headers['x-datadome']) {
    return { isChallenge: true, provider: 'DataDome' }
  }

  if (html.length < 2000 && !html.includes('<body') && !html.includes('<div')) {
    return { isChallenge: true, provider: 'Unknown (minimal HTML)' }
  }

  return { isChallenge: false, provider: null }
}

/* ── URL Probing ── */
async function probeUrls(domain: string): Promise<{ probeResults: Record<string, { exists: boolean; headers?: Record<string, string>; snippet?: string }> }> {
  const cleanDomain = normalizeDomain(domain)
  const baseUrl = `https://${cleanDomain}`

  const probes: { path: string; label: string }[] = [
    { path: '/robots.txt', label: 'robots' },
    { path: '/sitemap.xml', label: 'sitemap' },
    { path: '/wp-login.php', label: 'wordpress_login' },
    { path: '/wp-json/wp/v2/posts', label: 'wordpress_api' },
    { path: '/favicon.ico', label: 'favicon' },
    { path: '/manifest.json', label: 'manifest' },
    { path: '/sw.js', label: 'service_worker' },
  ]

  const probeResults: Record<string, { exists: boolean; headers?: Record<string, string>; snippet?: string }> = {}

  const probePromises = probes.map(async (probe) => {
    try {
      const result = await fetchHTML(`${baseUrl}${probe.path}`, true, 3)
      const exists = result.statusCode >= 200 && result.statusCode < 400
      probeResults[probe.label] = {
        exists,
        headers: exists ? result.headers : undefined,
        snippet: exists ? result.html.slice(0, 2000) : undefined,
      }
    } catch {
      probeResults[probe.label] = { exists: false }
    }
  })

  await Promise.allSettled(probePromises)

  return { probeResults }
}

/* ── Extract tools from URL probes ── */
function toolsFromProbes(probeResults: Record<string, { exists: boolean; headers?: Record<string, string>; snippet?: string }>): DetectedTool[] {
  const tools: DetectedTool[] = []

  if (probeResults.wordpress_login?.exists || probeResults.wordpress_api?.exists) {
    tools.push({
      category: 'cms',
      tool_name: 'WordPress',
      tool_version: null,
      confidence: 0.95,
      details: { evidence: probeResults.wordpress_api?.exists ? 'WP REST API endpoint responds' : 'wp-login.php exists', source: 'url_probe' },
    })
  }

  const robotsSnippet = probeResults.robots?.snippet || ''
  if (robotsSnippet) {
    if (robotsSnippet.includes('wp-admin')) {
      if (!tools.some(t => t.tool_name === 'WordPress')) {
        tools.push({ category: 'cms', tool_name: 'WordPress', tool_version: null, confidence: 0.90, details: { evidence: 'robots.txt mentions wp-admin', source: 'url_probe' } })
      }
    }
    if (robotsSnippet.includes('Shopify')) {
      tools.push({ category: 'ecommerce', tool_name: 'Shopify', tool_version: null, confidence: 0.95, details: { evidence: 'robots.txt mentions Shopify paths', source: 'url_probe' } })
    }
  }

  const sitemapSnippet = probeResults.sitemap?.snippet || ''
  if (sitemapSnippet) {
    if (sitemapSnippet.includes('wp-sitemap') || sitemapSnippet.includes('yoast')) {
      tools.push({ category: 'seo', tool_name: 'Yoast SEO', tool_version: null, confidence: 0.90, details: { evidence: 'Yoast pattern in sitemap XML', source: 'url_probe' } })
    }
  }

  const swSnippet = probeResults.service_worker?.snippet || ''
  if (swSnippet) {
    if (swSnippet.includes('workbox') || swSnippet.includes('Workbox')) {
      tools.push({ category: 'performance', tool_name: 'Workbox (Service Worker)', tool_version: null, confidence: 0.90, details: { evidence: 'Workbox service worker detected', source: 'url_probe' } })
    }
    if (swSnippet.includes('OneSignal') || swSnippet.includes('onesignal')) {
      tools.push({ category: 'ux_widgets', tool_name: 'OneSignal (Push Notifications)', tool_version: null, confidence: 0.90, details: { evidence: 'OneSignal in service worker', source: 'url_probe' } })
    }
  }

  const manifestSnippet = probeResults.manifest?.snippet || ''
  if (manifestSnippet && manifestSnippet.includes('{')) {
    tools.push({ category: 'frontend_framework', tool_name: 'Progressive Web App (PWA)', tool_version: null, confidence: 0.80, details: { evidence: 'manifest.json present', source: 'url_probe' } })
  }

  return tools
}

/* ══════════════════════════════════════════════════════════════════
 * ANTHROPIC API WITH WEB SEARCH
 * Uses the web_search_20250305 tool for comprehensive analysis
 * ══════════════════════════════════════════════════════════════════ */

const MARTECH_ANALYST_SYSTEM = `You are an expert martech analyst specializing in identifying and evaluating marketing technology stacks from website analysis.

You have access to a web_search tool. Use it strategically to:
1. Search for "[domain] technology stack" or "[domain] built with" to find what technologies the site uses
2. Search for "[domain] site:[builtwith.com OR wappalyzer.com OR similartech.com]" for tech detection databases
3. Search for specific technologies you suspect based on the HTML signals provided

Your analysis must cover these technology categories:
- Tag Management (GTM, Tealium, Adobe Launch, etc.)
- Analytics & Web Intelligence (GA4, Adobe Analytics, Mixpanel, Heap, Hotjar, Clarity, etc.)
- CRM & Marketing Automation (HubSpot, Salesforce, Marketo, Pardot, Klaviyo, etc.)
- CDP & Data Layer (Segment, mParticle, Tealium AudienceStream, etc.)
- Advertising & Paid Media (Meta Pixel, LinkedIn Insight, Google Ads, DoubleClick, Criteo, etc.)
- Personalization & Testing (Optimizely, VWO, Dynamic Yield, AB Tasty, etc.)
- SEO & Content Intelligence (tools detectable via scripts or meta patterns, structured data types)
- Chat & CX (Intercom, Drift, Zendesk, Salesforce Live Agent, Tawk.to, etc.)
- Consent Management (OneTrust, Cookiebot, TrustArc, Iubenda, Didomi, etc.)
- E-commerce & Commerce (Shopify, Magento, SAP Commerce, commercetools, etc.)
- CMS / DXP (WordPress, Drupal, Adobe Experience Manager, Contentful, etc.)
- Frontend Framework (React, Next.js, Vue, Angular, jQuery, etc.)
- Hosting & CDN (AWS, Vercel, Cloudflare, Akamai, Fastly, etc.)
- Security & WAF (Cloudflare WAF, Akamai, Imperva, reCAPTCHA, etc.)
- Performance Monitoring (New Relic, Datadog, Sentry, SpeedCurve, etc.)
- Fonts & Media (Google Fonts, Adobe Fonts, Cloudinary, etc.)
- Payment (Stripe, PayPal, Adyen, Klarna, etc.)
- Accessibility (AccessiBe, UserWay, etc.)
- UX & Widgets (Trustpilot, reviews, popups, push notifications, etc.)

CATEGORY KEYS to use (exactly):
cms, ecommerce, frontend_framework, hosting, analytics, tag_manager, customer_data, session_recording, ab_testing, ad_platforms, seo, social, marketing_automation, email_platform, crm, affiliate, personalization, chat_support, consent_management, accessibility, fonts_media, ux_widgets, cdn, performance, security, dns, image_optimization, error_monitoring, payment, other

For each technology identified, specify:
- category: exact category key from above
- tool_name: official product name
- tool_version: version if detectable, null otherwise
- confidence: HIGH (0.90+) = direct script/tag/header found, MEDIUM (0.70-0.89) = indirect signals or web search confirmation, LOW (0.50-0.69) = inferred
- evidence: brief explanation of how it was detected

Then provide:

MATURITY SCORE (0-100) with tier label:
- 0-25: Basic
- 26-50: Developing
- 51-75: Advanced
- 76-100: Best-in-Class

Score based on: stack completeness, integration sophistication, presence of CDP/data layer, consent management, testing & personalization capability.

GAP ANALYSIS: Identify missing categories or weak points vs. industry best practice for the apparent business type. For each gap specify severity (high/medium/low).

RECOMMENDATIONS: 3-5 prioritized, actionable suggestions to improve the martech stack.

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown fences, no explanation outside the JSON):
{
  "tools": [
    {
      "category": "<exact_category_key>",
      "tool_name": "<official_product_name>",
      "tool_version": "<version_or_null>",
      "confidence": <0.0-1.0>,
      "evidence": "<concise_evidence_string>"
    }
  ],
  "maturity_score": <0-100>,
  "maturity_tier": "<Basic|Developing|Advanced|Best-in-Class>",
  "gap_analysis": [
    {
      "category": "<category_key>",
      "label": "<readable label>",
      "severity": "<high|medium|low>",
      "description": "<what is missing and why it matters>"
    }
  ],
  "recommendations": [
    {
      "priority": <1-5>,
      "title": "<short title>",
      "description": "<actionable description>",
      "category": "<relevant category_key>"
    }
  ]
}`

/* ── Call Anthropic API with web_search tool ── */
async function callAnthropicWithSearch(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 8192
): Promise<{ text: string; usage: DetectionUsage }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    temperature: 0.1,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5,
      },
    ],
  })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2025-04-14',
    },
    body,
  })

  if (!res.ok) {
    const errBody = await res.text()
    console.error(`[MarTech] Anthropic API error ${res.status}:`, errBody)
    // Fallback: try without web_search if the API version doesn't support it
    if (res.status === 400 || res.status === 422) {
      console.warn('[MarTech] Falling back to API call without web_search tool...')
      return callAnthropicBasic(systemPrompt, userMessage, maxTokens)
    }
    throw new Error(`Anthropic API error ${res.status}: ${errBody.slice(0, 200)}`)
  }

  const data = await res.json() as {
    content: Array<{ type: string; text?: string }>
    usage?: { input_tokens: number; output_tokens: number }
  }

  // Extract text from all text blocks (the API may return web_search_tool_result blocks too)
  let fullText = ''
  for (const block of data.content) {
    if (block.type === 'text' && block.text) {
      fullText += block.text
    }
  }

  if (!fullText) throw new Error('Anthropic API: no text in response')

  return {
    text: fullText,
    usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    },
  }
}

/* ── Fallback: basic Anthropic call without tools ── */
async function callAnthropicBasic(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 8192
): Promise<{ text: string; usage: DetectionUsage }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    temperature: 0.1,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${errBody.slice(0, 200)}`)
  }

  const data = await res.json() as {
    content: Array<{ type: string; text?: string }>
    usage?: { input_tokens: number; output_tokens: number }
  }

  const textBlock = data.content.find(b => b.type === 'text')
  if (!textBlock?.text) throw new Error('Anthropic API: no text in response')

  return {
    text: textBlock.text,
    usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    },
  }
}

/* ── Build signal summary for AI ── */
function buildSignalsSummary(domain: string, signals: AggregatedSignals): string {
  return `DOMAIN: ${domain}
PAGES SCANNED: ${signals.pagesScanned}

RESPONSE HEADERS:
${Object.entries(signals.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}

COOKIE NAMES (from Set-Cookie):
${signals.cookieHeaders.join('\n') || '(none)'}

SCRIPT SOURCES (${signals.scripts.filter(s => !s.startsWith('[inline]')).length} external, ${signals.scripts.filter(s => s.startsWith('[inline]')).length} inline):
${signals.scripts.join('\n')}

LINK HREFS (${signals.links.length}):
${signals.links.join('\n')}

META TAGS (${signals.metas.length}):
${signals.metas.join('\n')}

PRECONNECT/PRELOAD HINTS (${signals.preconnects.length}):
${signals.preconnects.join('\n')}

JSON-LD / STRUCTURED DATA (${signals.jsonLd.length}):
${signals.jsonLd.join('\n---\n')}

NOSCRIPT TRACKING PIXELS (${signals.noscripts.length}):
${signals.noscripts.join('\n')}

IFRAMES (${signals.iframes.length}):
${signals.iframes.join('\n')}

DATA ATTRIBUTES (${signals.dataAttributes.length}):
${signals.dataAttributes.join(', ')}

HTML COMMENTS (${signals.htmlComments.length}):
${signals.htmlComments.join('\n')}

HEAD HTML (homepage, first 12000 chars):
${signals.headHtml}

BODY HTML SNIPPETS (from ${signals.pagesScanned} pages):
${signals.bodySnippet}`
}

/* ── Parse structured AI response ── */
interface AIAnalysisResult {
  tools: Array<{
    category: string
    tool_name: string
    tool_version: string | null
    confidence: number
    evidence: string
    sub_category?: string
  }>
  maturity_score: number
  maturity_tier: string
  gap_analysis: GapItem[]
  recommendations: Recommendation[]
}

function parseAIResponse(text: string): AIAnalysisResult {
  let jsonText = text.trim()
  // Strip markdown code fences
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  // Try to find JSON in the text if there's preamble
  const jsonStart = jsonText.indexOf('{')
  const jsonEnd = jsonText.lastIndexOf('}')
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    jsonText = jsonText.slice(jsonStart, jsonEnd + 1)
  }

  const parsed = JSON.parse(jsonText)

  return {
    tools: parsed.tools || [],
    maturity_score: typeof parsed.maturity_score === 'number' ? parsed.maturity_score : 30,
    maturity_tier: parsed.maturity_tier || 'Developing',
    gap_analysis: (parsed.gap_analysis || []).map((g: Record<string, unknown>) => ({
      category: String(g.category || 'other'),
      label: String(g.label || 'Unknown'),
      severity: (['high', 'medium', 'low'].includes(String(g.severity)) ? g.severity : 'medium') as 'high' | 'medium' | 'low',
      description: String(g.description || ''),
    })),
    recommendations: (parsed.recommendations || []).map((r: Record<string, unknown>) => ({
      priority: typeof r.priority === 'number' ? r.priority : 3,
      title: String(r.title || ''),
      description: String(r.description || ''),
      category: String(r.category || 'other'),
    })),
  }
}

/* ── Completeness Validator ── */
function validateCompleteness(
  domain: string,
  tools: DetectedTool[],
  signals: AggregatedSignals
): CompletenessReport {
  const diagnostics: CompletenessReport['diagnostics'] = []
  let score = 0

  const totalSignals = signals.scripts.length + signals.links.length + signals.metas.length +
    signals.jsonLd.length + signals.preconnects.length + signals.noscripts.length +
    signals.iframes.length + signals.dataAttributes.length

  const signalQuality: CompletenessReport['signalQuality'] = {
    scripts: signals.scripts.length,
    links: signals.links.length,
    metas: signals.metas.length,
    htmlSize: signals.totalHtmlSize,
    jsonLd: signals.jsonLd.length,
    preconnects: signals.preconnects.length,
    noscripts: signals.noscripts.length,
    iframes: signals.iframes.length,
    dataAttributes: signals.dataAttributes.length,
  }

  // 1. Signal quality assessment (max 30 points)
  if (signals.scripts.length >= 20) {
    score += 15
    diagnostics.push({ type: 'success', message: `Rich signal: ${signals.scripts.length} scripts detected across ${signals.pagesScanned} page(s)` })
  } else if (signals.scripts.length >= 10) {
    score += 10
    diagnostics.push({ type: 'info', message: `Moderate signal: ${signals.scripts.length} scripts detected` })
  } else if (signals.scripts.length >= 3) {
    score += 5
    diagnostics.push({ type: 'warning', message: `Low signal: only ${signals.scripts.length} scripts found. The site may use heavy client-side rendering or block crawlers.` })
  } else {
    diagnostics.push({ type: 'error', message: `Very low signal: only ${signals.scripts.length} scripts found. Possible causes: bot protection, JavaScript rendering, IP/geo blocking, or the site serves minimal HTML.` })
  }

  if (signals.totalHtmlSize > 100000) {
    score += 10
  } else if (signals.totalHtmlSize > 30000) {
    score += 7
  } else if (signals.totalHtmlSize > 10000) {
    score += 3
    diagnostics.push({ type: 'warning', message: `Small HTML payload (${Math.round(signals.totalHtmlSize / 1024)}KB). The site may rely on client-side rendering (SPA).` })
  } else {
    diagnostics.push({ type: 'error', message: `Very small HTML payload (${Math.round(signals.totalHtmlSize / 1024)}KB). Likely a SPA, bot challenge page, or geo-blocked response.` })
  }

  if (signals.pagesScanned >= 3) {
    score += 5
    diagnostics.push({ type: 'success', message: `Multi-page scan: ${signals.pagesScanned} pages analyzed for broader coverage` })
  } else if (signals.pagesScanned === 1) {
    diagnostics.push({ type: 'info', message: 'Only homepage was scanned (no crawlable subpages found)' })
  }

  // 2. Tool coverage assessment (max 50 points)
  const categories = new Set(tools.map(t => t.category))

  const essentialChecks: Array<{ cats: string[]; label: string; points: number }> = [
    { cats: ['analytics', 'tag_manager'], label: 'Analytics/Tag Management', points: 8 },
    { cats: ['cms', 'ecommerce', 'frontend_framework'], label: 'Platform/CMS/Framework', points: 8 },
    { cats: ['cdn', 'hosting', 'dns'], label: 'Infrastructure (CDN/Hosting/DNS)', points: 7 },
    { cats: ['seo'], label: 'SEO & Structured Data', points: 7 },
    { cats: ['consent_management'], label: 'Consent/Privacy Management', points: 5 },
    { cats: ['security'], label: 'Security', points: 5 },
    { cats: ['ad_platforms'], label: 'Advertising Pixels', points: 5 },
    { cats: ['fonts_media'], label: 'Fonts & Media', points: 5 },
  ]

  for (const check of essentialChecks) {
    const found = check.cats.some(c => categories.has(c))
    if (found) {
      score += check.points
    } else {
      diagnostics.push({ type: 'warning', message: `No ${check.label} detected — unusual for a commercial website` })
    }
  }

  // 3. Tool count assessment (max 20 points)
  if (tools.length >= 20) {
    score += 20
    diagnostics.push({ type: 'success', message: `Comprehensive: ${tools.length} technologies identified` })
  } else if (tools.length >= 12) {
    score += 15
    diagnostics.push({ type: 'success', message: `Good coverage: ${tools.length} technologies identified` })
  } else if (tools.length >= 7) {
    score += 10
    diagnostics.push({ type: 'info', message: `Moderate: ${tools.length} technologies identified` })
  } else if (tools.length >= 3) {
    score += 5
    diagnostics.push({ type: 'warning', message: `Below average: only ${tools.length} technologies detected.` })
  } else {
    diagnostics.push({ type: 'error', message: `Very few tools (${tools.length}) detected. The analysis is likely incomplete.` })
  }

  if (signals.pagesFailed.length > 0) {
    diagnostics.push({
      type: 'info',
      message: `${signals.pagesFailed.length} subpage(s) failed to load: ${signals.pagesFailed.join(', ')}`
    })
  }

  let level: CompletenessReport['level']
  if (score >= 80) level = 'complete'
  else if (score >= 60) level = 'good'
  else if (score >= 35) level = 'partial'
  else level = 'incomplete'

  return {
    score: Math.min(100, score),
    level,
    pagesScanned: signals.pagesScanned,
    totalSignals,
    diagnostics,
    signalQuality,
  }
}

/* ── Merge and deduplicate tools ── */
function mergeTools(patternTools: DetectedTool[], aiTools: DetectedTool[], probeTools: DetectedTool[]): DetectedTool[] {
  const toolMap = new Map<string, DetectedTool>()

  const key = (t: DetectedTool) => `${t.category}::${t.tool_name.toLowerCase().replace(/\s+/g, ' ').trim()}`

  // Pattern tools go first (highest priority — deterministic)
  for (const tool of patternTools) {
    const k = key(tool)
    if (!toolMap.has(k) || (toolMap.get(k)!.confidence < tool.confidence)) {
      toolMap.set(k, { ...tool, details: { ...tool.details, source: 'pattern' } })
    }
  }

  // Probe tools
  for (const tool of probeTools) {
    const k = key(tool)
    if (!toolMap.has(k) || (toolMap.get(k)!.confidence < tool.confidence)) {
      toolMap.set(k, tool)
    }
  }

  // AI tools (fill gaps — lower priority)
  for (const tool of aiTools) {
    const k = key(tool)
    if (!toolMap.has(k)) {
      toolMap.set(k, { ...tool, details: { ...tool.details, source: 'ai' } })
    } else {
      // If AI found it too, boost confidence slightly
      const existing = toolMap.get(k)!
      if (existing.confidence < 0.95) {
        existing.confidence = Math.min(0.98, existing.confidence + 0.05)
      }
    }
  }

  return Array.from(toolMap.values()).sort((a, b) => b.confidence - a.confidence)
}

/* ══════════════════════════════════════════════════════════════════
 * MAIN DETECTION PIPELINE
 * Hybrid: Pattern Matching → URL Probing → AI with Web Search
 * → Merge → Maturity Score → Gap Analysis → Recommendations
 * ══════════════════════════════════════════════════════════════════ */
export async function detectMartechStack(domain: string): Promise<DetectionResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured. Add the key to environment variables.')
  }

  const cleanDomain = normalizeDomain(domain)
  console.log(`[MarTech] ═══ Starting V3 HYBRID+WEBSEARCH detection for ${cleanDomain} ═══`)

  // Step 1: Multi-page signal collection + URL probing (in parallel)
  const [signals, { probeResults }] = await Promise.all([
    fetchMultiPageSignals(cleanDomain),
    probeUrls(cleanDomain),
  ])

  console.log(`[MarTech] Collected signals from ${signals.pagesScanned} page(s): ${signals.scripts.length} scripts, ${signals.links.length} links, ${signals.metas.length} metas, ${signals.jsonLd.length} JSON-LD`)
  console.log(`[MarTech] URL probes: ${Object.entries(probeResults).filter(([, v]) => v.exists).map(([k]) => k).join(', ') || 'none responded'}`)

  // Step 1.5: Detect bot challenge
  const fullHtml = signals.headHtml + signals.bodySnippet
  const challengeCheck = detectBotChallenge(fullHtml, signals.headers)
  if (challengeCheck.isChallenge) {
    console.warn(`[MarTech] ⚠ Bot challenge detected: ${challengeCheck.provider}. HTML may be incomplete.`)
  }

  // Step 2: DETERMINISTIC pattern matching (fast, reliable, no API call)
  const { runPatternMatching } = await import('./patterns')
  const patternMatches = runPatternMatching({
    html: fullHtml,
    headers: signals.headers,
    scripts: signals.scripts,
    cookies: signals.cookieHeaders,
    metas: signals.metas,
  })
  const patternTools: DetectedTool[] = patternMatches.map(m => ({
    category: m.category,
    tool_name: m.tool_name,
    tool_version: m.tool_version || null,
    confidence: m.confidence,
    details: { evidence: m.evidence, source: 'pattern' },
  }))
  console.log(`[MarTech] Pattern matching: ${patternTools.length} tools detected deterministically`)

  // Step 3: URL probe tools
  const probeTools = toolsFromProbes(probeResults)
  console.log(`[MarTech] URL probes: ${probeTools.length} additional tools from probing`)

  // Step 4: AI classification WITH WEB SEARCH (the big upgrade)
  const signalsSummary = buildSignalsSummary(cleanDomain, signals)

  // Add probe results to context
  const probeContext = Object.entries(probeResults)
    .filter(([, v]) => v.exists && v.snippet)
    .map(([label, v]) => `[${label}] ${v.snippet!.slice(0, 500)}`)
    .join('\n\n')

  // Add pattern matches to context so AI doesn't duplicate
  const patternContext = patternTools.length > 0
    ? `\nALREADY DETECTED BY PATTERN MATCHING (${patternTools.length} tools, DO NOT repeat these, focus on finding ADDITIONAL technologies):\n${patternTools.map(t => `- ${t.tool_name} (${t.category})`).join('\n')}`
    : ''

  // Build the user message
  const userMessage = `Analyze the martech stack of this website: https://${cleanDomain}

Use web_search to:
1. Search for "${cleanDomain} technology stack" or "${cleanDomain} built with" on BuiltWith/Wappalyzer/SimilarTech
2. Search for the company name + "marketing technology" or "tech stack"
3. Verify any technologies you're uncertain about from the HTML signals

Then combine web search results with the HTML signals I collected below to deliver:
1. Full technology inventory by category (be EXHAUSTIVE — every pixel, SDK, font, CDN, script)
2. Maturity Score (0-100) with tier
3. Gap analysis vs. industry best practice
4. Prioritized recommendations (3-5)
${patternContext}

${challengeCheck.isChallenge ? `\n⚠ NOTE: Bot protection (${challengeCheck.provider}) was detected. HTML signals may be incomplete. Rely more on web search for this site.\n` : ''}

URL PROBE RESULTS:
${probeContext || '(no probe results)'}

COLLECTED HTML SIGNALS:
${signalsSummary}`

  let aiAnalysis: AIAnalysisResult = {
    tools: [],
    maturity_score: 30,
    maturity_tier: 'Developing',
    gap_analysis: [],
    recommendations: [],
  }
  let totalUsage: DetectionUsage = { input_tokens: 0, output_tokens: 0 }

  try {
    console.log(`[MarTech] Calling AI with web_search (sending ~${Math.round(userMessage.length / 1000)}K chars)...`)
    const { text, usage } = await callAnthropicWithSearch(
      MARTECH_ANALYST_SYSTEM,
      userMessage,
      8192
    )
    totalUsage = usage
    console.log(`[MarTech] AI response received: ${usage.input_tokens} in / ${usage.output_tokens} out tokens`)

    aiAnalysis = parseAIResponse(text)
    console.log(`[MarTech] AI found: ${aiAnalysis.tools.length} tools, maturity: ${aiAnalysis.maturity_score}/100 (${aiAnalysis.maturity_tier}), ${aiAnalysis.gap_analysis.length} gaps, ${aiAnalysis.recommendations.length} recommendations`)
  } catch (err) {
    console.error(`[MarTech] AI analysis failed:`, err instanceof Error ? err.message : err)
    // Continue with pattern + probe results even if AI fails
  }

  // Convert AI tools to DetectedTool format
  const aiTools: DetectedTool[] = aiAnalysis.tools.map(t => ({
    category: t.category || 'other',
    tool_name: t.tool_name || 'Unknown',
    tool_version: t.tool_version || null,
    confidence: typeof t.confidence === 'number' ? t.confidence : 0.5,
    details: {
      ...(t.evidence ? { evidence: t.evidence } : {}),
      ...(t.sub_category ? { sub_category: t.sub_category } : {}),
      source: 'ai_websearch',
    },
  }))

  // Step 5: Merge all sources
  const allTools = mergeTools(patternTools, aiTools, probeTools)
  console.log(`[MarTech] Merged: ${allTools.length} total unique tools`)

  // Step 6: Completeness validation
  const completeness = validateCompleteness(cleanDomain, allTools, signals)

  // Add detection method breakdown
  if (challengeCheck.isChallenge) {
    completeness.diagnostics.unshift({
      type: 'warning',
      message: `Bot protection detected (${challengeCheck.provider}). HTML signals may be incomplete — web search compensates for this.`
    })
  }

  completeness.diagnostics.push({
    type: 'info',
    message: `Detection: ${patternTools.length} pattern + ${probeTools.length} probe + ${aiTools.length} AI/web-search → ${allTools.length} unique after merge`
  })

  // Use AI maturity score if we have it, otherwise compute from tools
  let maturityScore = aiAnalysis.maturity_score
  let maturityTier = aiAnalysis.maturity_tier as DetectionResult['maturityTier']

  // If AI didn't provide a score, compute a basic one
  if (aiAnalysis.tools.length === 0) {
    maturityScore = computeFallbackMaturity(allTools)
    if (maturityScore <= 25) maturityTier = 'Basic'
    else if (maturityScore <= 50) maturityTier = 'Developing'
    else if (maturityScore <= 75) maturityTier = 'Advanced'
    else maturityTier = 'Best-in-Class'
  }

  // Validate maturity tier matches score
  if (maturityScore <= 25) maturityTier = 'Basic'
  else if (maturityScore <= 50) maturityTier = 'Developing'
  else if (maturityScore <= 75) maturityTier = 'Advanced'
  else maturityTier = 'Best-in-Class'

  console.log(`[MarTech] ═══ Final: ${allTools.length} tools, maturity ${maturityScore}/100 (${maturityTier}), completeness ${completeness.score}/100 (${completeness.level}) ═══`)

  return {
    tools: allTools,
    usage: totalUsage,
    completeness,
    maturityScore,
    maturityTier,
    gapAnalysis: aiAnalysis.gap_analysis,
    recommendations: aiAnalysis.recommendations.sort((a, b) => a.priority - b.priority),
  }
}

/* ── Fallback maturity score computation ── */
function computeFallbackMaturity(tools: DetectedTool[]): number {
  let score = 0
  const cats = new Set(tools.map(t => t.category))

  // Basic presence scores
  if (cats.has('analytics') || cats.has('tag_manager')) score += 15
  if (cats.has('cms') || cats.has('ecommerce') || cats.has('frontend_framework')) score += 10
  if (cats.has('cdn') || cats.has('hosting')) score += 8
  if (cats.has('seo')) score += 8
  if (cats.has('consent_management')) score += 10
  if (cats.has('ad_platforms')) score += 7
  if (cats.has('security')) score += 5

  // Sophistication bonuses
  if (cats.has('customer_data')) score += 10  // CDP
  if (cats.has('ab_testing') || cats.has('personalization')) score += 10 // Testing/personalization
  if (cats.has('session_recording')) score += 5
  if (cats.has('marketing_automation') || cats.has('crm')) score += 7
  if (cats.has('error_monitoring') || cats.has('performance')) score += 5

  return Math.min(100, score)
}
