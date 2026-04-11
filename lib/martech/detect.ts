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
    // Skip assets, anchors, query-only
    if (path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|xml|json|mp4|webm)$/i)) continue
    if (path.startsWith('/_') || path.startsWith('/api/') || path.startsWith('/wp-admin')) continue
    found.add(path)
  }

  // Also extract absolute links to same domain
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
  // Priority pages likely to have different tech (e.g., checkout, product pages, blog)
  const priorityPatterns = [
    /^\/(en|it|es|fr|de)\/?$/i,         // language homepages
    /\/products?\//i,                     // product pages
    /\/shop\/?/i,                         // shop section
    /\/blog\/?/i,                         // blog (often different CMS)
    /\/about/i,                           // about page
    /\/contact/i,                         // contact page (forms, chat widgets)
    /\/cart/i,                            // cart page (payment, checkout tech)
    /\/checkout/i,                        // checkout
    /\/account/i,                         // account area
    /\/login/i,                           // login page
    /\/privacy|\/cookie/i,               // privacy/cookie pages (CMP details)
    /\/news\/?/i,                         // news section
    /\/collection/i,                      // collection pages (e-commerce)
    /\/category/i,                        // category pages
  ]

  const prioritized: string[] = []
  const rest: string[] = []

  for (const link of links) {
    if (priorityPatterns.some(p => p.test(link))) {
      prioritized.push(link)
    } else if (link.split('/').filter(Boolean).length <= 2) {
      // shallow paths (max 2 levels)
      rest.push(link)
    }
  }

  // Return top 3 priority + 1 random shallow page
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

  // Inline scripts — LARGER capture (500 chars instead of 150)
  const inlineScriptRegex = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi
  while ((match = inlineScriptRegex.exec(html)) !== null) {
    const content = match[1].trim()
    if (content.length < 15) continue
    // Skip if it's just a src script (already captured)
    if (match[0].includes(' src=')) continue
    // Capture up to 500 chars, prioritizing known patterns
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

  // JSON-LD — LARGER capture (1000 chars)
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

  // Noscript content (tracking pixels as <img>)
  const noscriptRegex = /<noscript[^>]*>([\s\S]*?)<\/noscript>/gi
  const noscriptContent: string[] = []
  while ((match = noscriptRegex.exec(html)) !== null) {
    const content = match[1].trim().slice(0, 300)
    if (content.length > 5) noscriptContent.push(content)
  }

  // Iframes (chat widgets, embeds, tracking)
  const iframeRegex = /<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi
  const iframes: string[] = []
  while ((match = iframeRegex.exec(html)) !== null) {
    iframes.push(match[1])
  }

  // Data attributes (data-*, ng-*, v-*, x-* — framework hints)
  const dataAttrRegex = /\s(data-[a-z][\w-]*|ng-[a-z]+|v-[a-z]+|x-[a-z]+)(?:=["'][^"']*["'])?/gi
  const dataAttributes = new Set<string>()
  while ((match = dataAttrRegex.exec(html)) !== null) {
    dataAttributes.add(match[1].toLowerCase())
  }

  // HTML comments (often contain CMS/platform signatures)
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

  // Body — capture first 10000 chars + last 5000 chars (footer often has tracking)
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

  // 1. Fetch homepage
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

  // 2. Find subpages to crawl
  const internalLinks = extractInternalLinks(homeResult.html, cleanDomain)
  const subpages = pickSubpages(internalLinks)
  console.log(`[MarTech] Found ${internalLinks.length} internal links, will crawl ${subpages.length} subpages: ${subpages.join(', ')}`)

  // 3. Fetch subpages in parallel (with timeout per page)
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

  // 4. Merge signals (deduplicate where possible)
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

  // Merge all headers (homepage headers are primary)
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

    // Merge subpage headers (add any new ones)
    for (const [k, v] of Object.entries(sig.headers)) {
      if (!mergedHeaders[k]) mergedHeaders[k] = v
    }
  }

  // Build body snippets section with page labels
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

/* ── AI Classification prompt ── */
const CLASSIFICATION_SYSTEM = `You are a senior enterprise MarTech stack analyst performing a comprehensive technology audit for a consulting engagement (Accenture / Gartner level). Your analysis must be EXHAUSTIVE — identify EVERY externally observable technology, platform, service, SDK, pixel, and integration.

IMPORTANT: The data provided may come from MULTIPLE pages of the same website. Analyze ALL signals together to build the most complete picture.

## CATEGORIES (use EXACTLY these category keys)

### Platform & Content
- cms — CMS / DXP (WordPress, Drupal, Adobe Experience Manager, Sitecore, Contentful, Strapi, Sanity, Kentico, Umbraco, Shopify CMS, Salesforce CMS)
- ecommerce — E-Commerce Platform (Shopify, Magento/Adobe Commerce, Salesforce Commerce Cloud, BigCommerce, WooCommerce, PrestaShop, SAP Commerce, Hybris, commercetools, VTEX)
- frontend_framework — Frontend Framework (Next.js, React, Vue, Nuxt, Angular, Svelte, Gatsby, Astro, Remix, Ember, jQuery, Alpine.js, HTMX)
- hosting — Hosting / PaaS (Vercel, Netlify, AWS, Azure, GCP, Heroku, DigitalOcean, Fly.io, Railway, Render, Fastly Compute)

### Data & Intelligence
- analytics — Web Analytics & BI (Google Analytics 4, Universal Analytics, Adobe Analytics, Matomo, Piwik PRO, Plausible, Fathom, Amplitude, Mixpanel, Heap, Segment, Snowplow, Piano Analytics)
- tag_manager — Tag Management (Google Tag Manager, Adobe Launch, Tealium iQ, Ensighten, TagCommander, Piwik PRO Tag Manager)
- customer_data — CDP / DMP (Segment, mParticle, Tealium AudienceStream, Adobe Real-Time CDP, Salesforce Data Cloud, Treasure Data, Lytics, BlueConic, Bloomreach Engagement, Oracle BlueKai)
- session_recording — Session Recording & UX Analytics (Hotjar, FullStory, LogRocket, Mouseflow, Crazy Egg, Contentsquare, Quantum Metric, Smartlook, Microsoft Clarity, Lucky Orange)
- ab_testing — A/B Testing & Experimentation (VWO, Optimizely, AB Tasty, Google Optimize, Adobe Target, Kameleoon, LaunchDarkly, Split.io, Statsig, Convert)

### Acquisition & Marketing
- ad_platforms — Advertising Pixels & Attribution (Meta/Facebook Pixel, Google Ads/gtag, TikTok Pixel, LinkedIn Insight Tag, Twitter/X Pixel, Pinterest Tag, Snapchat Pixel, Criteo, DoubleClick/DV360, Amazon Ads, AdRoll, TradeDesk, Taboola, Outbrain)
- seo — SEO & Structured Data (Schema.org/JSON-LD, Yoast, Rank Math, All in One SEO, Ahrefs, SEMrush, Moz, BrightEdge, Conductor, seoClarity, canonical tags, hreflang, Open Graph, robots meta)
- social — Social Media Integration (Facebook SDK, Twitter widgets, Instagram embed, LinkedIn API, AddThis, ShareThis, Pinterest, Disqus, social OG tags, oEmbed)
- marketing_automation — Marketing Automation (HubSpot, Marketo, Pardot/Salesforce, ActiveCampaign, Eloqua, Braze, Iterable, Klaviyo, Customer.io, Mailchimp automation, Drip, Omnisend)
- email_platform — Email Platform (Mailchimp, SendGrid, Mailgun, Amazon SES, Postmark, SparkPost, Sendinblue/Brevo, Constant Contact, Campaign Monitor, ConvertKit)
- crm — CRM (Salesforce, HubSpot CRM, Zoho CRM, Pipedrive, Microsoft Dynamics, Freshsales, SugarCRM, monday.com CRM)
- affiliate — Affiliate / Referral (Commission Junction/CJ, ShareASale, Impact, Awin, Partnerize, Rakuten, Tapfiliate, ReferralCandy, TUNE)

### Experience & Engagement
- personalization — Personalization & AI (Dynamic Yield, Algolia, Bloomreach, Salesforce Einstein, Adobe Sensei, Nosto, Monetate, Certona, Insider, Coveo, Kleecks)
- chat_support — Chat & Support (Intercom, Zendesk Chat, Drift, LiveChat, Tawk.to, Crisp, Freshchat, Olark, Tidio, HubSpot Chat, Gorgias, Chatbot frameworks)
- consent_management — Consent / CMP (Cookiebot, OneTrust, TrustArc, Didomi, Osano, CookieYes, Quantcast Choice, Usercentrics, Iubenda, Termly, Complianz, Civic Cookie Control)
- accessibility — Accessibility (AccessiBe, UserWay, AudioEye, EqualWeb, Recite Me, Level Access, Monsido, Siteimprove accessibility)
- fonts_media — Fonts & Media (Google Fonts, Adobe Fonts/Typekit, Font Awesome, custom font files, Wistia, Vimeo, YouTube embeds, JW Player, Brightcove, Cloudinary, Imgix)
- ux_widgets — UX & Widgets (Trustpilot, Yotpo, Bazaarvoice, Judge.me reviews, Privy popups, OptinMonster, Sumo, Hello Bar, Recaptcha, hCaptcha, Calendly, Typeform, interstitials, push notification services)

### Infrastructure & Performance
- cdn — CDN (Cloudflare, Akamai, Fastly, AWS CloudFront, Azure CDN, Google Cloud CDN, StackPath, KeyCDN, Bunny CDN, Imperva/Incapsula)
- performance — Performance Monitoring (New Relic, Datadog RUM, Dynatrace, SpeedCurve, WebPageTest, Core Web Vitals instrumentation, Pingdom, GTmetrix, custom RUM scripts)
- security — Security & WAF (Cloudflare WAF, Akamai Kona, Imperva WAF, AWS WAF, Sucuri, Wordfence, reCAPTCHA, hCaptcha, Content-Security-Policy, HSTS, X-Frame-Options, bot protection)
- dns — DNS & SSL (Cloudflare DNS, AWS Route 53, Google Cloud DNS, Let's Encrypt, DigiCert, Sectigo, GoDaddy DNS, DNSimple, NS1)
- image_optimization — Image Optimization (Cloudinary, Imgix, Fastly Image Optimizer, next/image, Thumbor, TinyPNG/TinyJPG, ShortPixel, ImageEngine, Sirv, lazy loading libraries)

### Governance & Operations
- error_monitoring — Error Monitoring (Sentry, Bugsnag, Rollbar, Datadog APM, Raygun, TrackJS, Airbrake, LogRocket errors, New Relic errors)
- payment — Payment (Stripe, PayPal, Braintree, Adyen, Square, Klarna, Afterpay, Apple Pay, Google Pay, Amazon Pay, Mollie, Razorpay, checkout.com)
- other — Other (anything that doesn't fit above categories — webhooks, internal tools, custom SDKs, unrecognized third-party scripts)

## DETECTION METHODOLOGY

Analyze ALL available signals systematically:

1. **HTTP Response Headers**: Server, X-Powered-By, Via, X-Cache, X-CDN, CF-Ray, CF-Cache-Status, X-Varnish, X-Akamai, Strict-Transport-Security, Content-Security-Policy, Set-Cookie patterns, X-Frame-Options, X-XSS-Protection, Feature-Policy
2. **Script Sources**: Domain patterns (cdn.*, js.*, static.*, assets.*), known SDK paths, version strings in URLs, loader scripts, async/defer patterns
3. **Inline Scripts**: dataLayer pushes, pixel initialization (fbq, gtag, _satellite, analytics.track), global config objects (window.__NEXT_DATA__, Shopify.*, __NUXT__), consent manager init, chat widget init
4. **Link/Stylesheet refs**: CDN origins, font services, theme paths (wp-content, /assets/themes/, /static/)
5. **Meta Tags**: generator, og:*, twitter:*, application-name, msapplication-*, apple-mobile-web-app, theme-color, viewport, robots, canonical, alternate hreflang, csp-nonce
6. **HTML structure**: data-* attributes, class naming patterns (wp-*, shopify-*, next-*, nuxt-*), noscript tags, comment signatures, preconnect/preload/prefetch hints, JSON-LD blocks
7. **Iframes**: Embedded third-party services, chat widgets, video players, form builders
8. **Cookie names**: Recognize known cookie patterns (__ga, _fbp, hubspotutk, __cfduid, etc.)
9. **Body content**: Footer tracking scripts, widget containers, chat bubbles, consent banners

## OUTPUT FORMAT

Return ONLY valid JSON:
{"tools":[{"category":"<exact_category_key>","tool_name":"<official_product_name>","tool_version":"<version_or_null>","confidence":<0.0-1.0>,"evidence":"<concise_evidence_string>","sub_category":"<optional_sub_type>"}]}

## RULES
- Be EXHAUSTIVE: report every technology you can detect, no matter how minor
- Distinguish between primary tools and supporting libraries (e.g., jQuery as dependency vs jQuery as main framework)
- Report EACH advertising pixel separately (Meta Pixel, Google Ads, TikTok etc.)
- Report EACH analytics tool separately (GA4, Hotjar, etc.)
- Report infrastructure signals from headers (CDN, WAF, server tech)
- For SEO: report schema types found (Organization, Product, BreadcrumbList, FAQ, etc.)
- For consent: identify CMP platform AND compliance framework (GDPR, CCPA)
- Confidence guide: 0.95+ = definitive (unique identifier), 0.8-0.94 = strong (multiple signals), 0.6-0.79 = probable (pattern match), 0.4-0.59 = possible (indirect evidence)
- Do NOT hallucinate tools. Only report what you can evidence from the signals provided.
- Use the EXACT category keys listed above. Do not invent new ones.`

/* ── Call Anthropic API ── */
async function callAnthropic(
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
    console.error(`[MarTech] Anthropic API error ${res.status}:`, errBody)
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

/* ── Parse AI response into tools array ── */
function parseToolsFromResponse(text: string): Array<{
  category: string
  tool_name: string
  tool_version: string | null
  confidence: number
  evidence: string
  sub_category?: string
}> {
  let jsonText = text.trim()
  // Strip markdown code fences
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  const parsed = JSON.parse(jsonText)

  if (!parsed.tools || !Array.isArray(parsed.tools)) {
    console.error('[MarTech] Unexpected response structure:', jsonText.slice(0, 500))
    throw new Error('AI response missing tools array')
  }

  return parsed.tools
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

/* ── AI Classification (primary pass) ── */
async function classifyWithAI(
  domain: string,
  signals: AggregatedSignals
): Promise<{ tools: DetectedTool[]; usage: DetectionUsage }> {
  const signalsSummary = buildSignalsSummary(domain, signals)

  console.log(`[MarTech] Sending to AI: ~${Math.round(signalsSummary.length / 1000)}K chars of signals`)

  const { text, usage } = await callAnthropic(
    CLASSIFICATION_SYSTEM,
    `Perform an EXHAUSTIVE enterprise technology audit on the following website signals from ${signals.pagesScanned} page(s). Identify ALL technologies, platforms, SDKs, pixels, tracking scripts, CDNs, fonts, frameworks, and third-party services. This is for a senior consulting partner — completeness is critical. Return ONLY the JSON object, no markdown, no explanation.\n\n${signalsSummary}`
  )

  console.log(`[MarTech] Primary pass usage: ${usage.input_tokens} in / ${usage.output_tokens} out tokens`)

  const parsedTools = parseToolsFromResponse(text)

  const tools = parsedTools.map(t => ({
    category: t.category || 'other',
    tool_name: t.tool_name || 'Unknown',
    tool_version: t.tool_version || null,
    confidence: typeof t.confidence === 'number' ? t.confidence : 0.5,
    details: {
      ...(t.evidence ? { evidence: t.evidence } : {}),
      ...(t.sub_category ? { sub_category: t.sub_category } : {}),
    },
  }))

  return { tools, usage }
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
  const areas = new Set<string>()

  // Check essential categories for a commercial site
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
    diagnostics.push({ type: 'warning', message: `Below average: only ${tools.length} technologies detected. Consider re-running the analysis.` })
  } else {
    diagnostics.push({ type: 'error', message: `Very few tools (${tools.length}) detected. The analysis is likely incomplete.` })
  }

  // Failed pages info
  if (signals.pagesFailed.length > 0) {
    diagnostics.push({
      type: 'info',
      message: `${signals.pagesFailed.length} subpage(s) failed to load: ${signals.pagesFailed.join(', ')}`
    })
  }

  // Determine level
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

/* ── Deep Scan (second AI pass for incomplete results) ── */
const DEEP_SCAN_SYSTEM = `You are a senior MarTech analyst doing a SECOND-PASS review of a website technology audit. The FIRST pass found fewer technologies than expected. Your job is to:

1. Re-analyze ALL signals very carefully, looking for technologies that may have been missed
2. Look for INDIRECT evidence: cookie names suggesting specific platforms, CSS class naming conventions, HTML data attributes, comment signatures
3. Infer technologies from patterns: e.g., "wp-content" in paths = WordPress, "__next" data = Next.js, "shopify" in any context = Shopify
4. Check if common technologies are hiding behind CDN or proxy (e.g., scripts served from site's own domain but actually from GTM/GA)
5. Report ANY additional technologies found, even with lower confidence

Return ONLY valid JSON in the same format:
{"tools":[{"category":"<category_key>","tool_name":"<name>","tool_version":"<version_or_null>","confidence":<0.0-1.0>,"evidence":"<evidence>","sub_category":"<optional>"}],"analysis_notes":"<brief explanation of what you found or why detection is limited>"}`

async function deepScanPass(
  domain: string,
  signals: AggregatedSignals,
  firstPassTools: DetectedTool[]
): Promise<{ additionalTools: DetectedTool[]; usage: DetectionUsage; notes: string }> {
  const existingToolNames = firstPassTools.map(t => `${t.category}:${t.tool_name}`).join(', ')

  const signalsSummary = buildSignalsSummary(domain, signals)

  const userMessage = `SECOND-PASS DEEP ANALYSIS for ${domain}

The first pass detected only ${firstPassTools.length} tools: ${existingToolNames}

This seems INCOMPLETE for a commercial website. Please:
1. Re-analyze all signals very carefully
2. Look for ANY additional technologies, SDKs, pixels, or services
3. Check for technologies hidden behind proxies or CDNs
4. Look for cookie-based evidence of analytics/marketing tools
5. Identify framework patterns from HTML structure, data attributes, and class names
6. Report ONLY NEW tools not already listed above

If you believe the first pass was complete and no additional tools can be detected, explain WHY in analysis_notes (e.g., "site uses aggressive bot protection", "SPA with minimal HTML", "geo-restricted content").

SIGNALS:
${signalsSummary}`

  const { text, usage } = await callAnthropic(DEEP_SCAN_SYSTEM, userMessage, 4096)

  console.log(`[MarTech] Deep scan usage: ${usage.input_tokens} in / ${usage.output_tokens} out tokens`)

  let jsonText = text.trim()
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      tools: Array<{ category: string; tool_name: string; tool_version: string | null; confidence: number; evidence: string; sub_category?: string }>
      analysis_notes?: string
    }

    const additionalTools: DetectedTool[] = (parsed.tools || [])
      .filter(t => {
        // Deduplicate against first pass
        return !firstPassTools.some(
          existing => existing.tool_name.toLowerCase() === t.tool_name?.toLowerCase() &&
            existing.category === t.category
        )
      })
      .map(t => ({
        category: t.category || 'other',
        tool_name: t.tool_name || 'Unknown',
        tool_version: t.tool_version || null,
        confidence: typeof t.confidence === 'number' ? t.confidence : 0.5,
        details: {
          ...(t.evidence ? { evidence: t.evidence } : {}),
          ...(t.sub_category ? { sub_category: t.sub_category } : {}),
          source: 'deep_scan',
        },
      }))

    return {
      additionalTools,
      usage,
      notes: parsed.analysis_notes || '',
    }
  } catch (err) {
    console.error('[MarTech] Deep scan parse error:', text.slice(0, 500))
    return { additionalTools: [], usage, notes: 'Deep scan response could not be parsed' }
  }
}

/* ── Combined: Detect Full Stack with Completeness Controller ── */
export async function detectMartechStack(domain: string): Promise<DetectionResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured. Add the key to environment variables.')
  }

  const cleanDomain = normalizeDomain(domain)
  console.log(`[MarTech] ═══ Starting ENHANCED detection for ${cleanDomain} ═══`)

  // Step 1: Multi-page signal collection
  const signals = await fetchMultiPageSignals(cleanDomain)
  console.log(`[MarTech] Collected signals from ${signals.pagesScanned} page(s): ${signals.scripts.length} scripts, ${signals.links.length} links, ${signals.metas.length} metas, ${signals.jsonLd.length} JSON-LD, ${signals.iframes.length} iframes, ${signals.dataAttributes.length} data-attrs`)

  // Step 2: Primary AI classification
  const primaryResult = await classifyWithAI(cleanDomain, signals)
  console.log(`[MarTech] Primary pass: ${primaryResult.tools.length} tools detected`)

  let totalUsage: DetectionUsage = { ...primaryResult.usage }
  let allTools = [...primaryResult.tools]

  // Step 3: Completeness validation
  let completeness = validateCompleteness(cleanDomain, allTools, signals)
  console.log(`[MarTech] Completeness: ${completeness.score}/100 (${completeness.level})`)

  // Step 4: Deep scan if completeness is low
  if (completeness.level === 'incomplete' || completeness.level === 'partial') {
    console.log(`[MarTech] Triggering DEEP SCAN (completeness: ${completeness.level})...`)
    completeness.diagnostics.push({
      type: 'info',
      message: 'Automatic deep scan triggered due to low completeness score'
    })

    try {
      const deepResult = await deepScanPass(cleanDomain, signals, primaryResult.tools)

      // Merge usage
      totalUsage.input_tokens += deepResult.usage.input_tokens
      totalUsage.output_tokens += deepResult.usage.output_tokens

      if (deepResult.additionalTools.length > 0) {
        allTools = [...allTools, ...deepResult.additionalTools]
        completeness.diagnostics.push({
          type: 'success',
          message: `Deep scan found ${deepResult.additionalTools.length} additional technologies`
        })
        console.log(`[MarTech] Deep scan found ${deepResult.additionalTools.length} additional tools`)
      }

      if (deepResult.notes) {
        completeness.diagnostics.push({
          type: 'info',
          message: `AI analysis: ${deepResult.notes}`
        })
        console.log(`[MarTech] AI notes: ${deepResult.notes}`)
      }

      // Re-validate completeness with new tools
      completeness = validateCompleteness(cleanDomain, allTools, signals)
      // Keep the deep scan diagnostics
      if (deepResult.additionalTools.length > 0) {
        completeness.diagnostics.push({
          type: 'success',
          message: `Deep scan improved detection: now ${allTools.length} total tools (was ${primaryResult.tools.length})`
        })
      }
    } catch (err) {
      console.error('[MarTech] Deep scan failed:', err)
      completeness.diagnostics.push({
        type: 'error',
        message: `Deep scan failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      })
    }
  }

  console.log(`[MarTech] ═══ Final: ${allTools.length} tools, completeness ${completeness.score}/100 (${completeness.level}) ═══`)

  return {
    tools: allTools,
    usage: totalUsage,
    completeness,
  }
}
