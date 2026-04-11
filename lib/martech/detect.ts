import https from 'https'

/* ── Types ── */
export interface DetectedTool {
  category: string
  tool_name: string
  tool_version: string | null
  confidence: number
  details: Record<string, unknown> | null
}

/* ── Normalize domain ── */
function normalizeDomain(raw: string): string {
  let d = raw.trim()
  d = d.replace(/^https?:\/\//, '')
  d = d.replace(/\/+$/, '')
  return d
}

/* ── Fetch HTML via https module (handles SSL issues) ── */
function fetchHTML(url: string, rejectUnauthorized = true): Promise<{ html: string; headers: Record<string, string>; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy()
      reject(new Error('timeout'))
    }, 20000)

    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,it;q=0.8',
      },
      rejectUnauthorized,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout)
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString()
        resolve(fetchHTML(redirectUrl, rejectUnauthorized))
        res.resume()
        return
      }

      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        clearTimeout(timeout)
        const html = Buffer.concat(chunks).toString('utf-8')
        const headers: Record<string, string> = {}
        for (const [key, val] of Object.entries(res.headers)) {
          if (val) headers[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val
        }
        resolve({ html, headers, statusCode: res.statusCode || 200 })
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

/* ── Step 1: Fetch HTML + Headers ── */
export async function fetchSiteSignals(domain: string): Promise<{
  scripts: string[]
  links: string[]
  metas: string[]
  headers: Record<string, string>
  rawSnippet: string
  jsonLd: string[]
  preconnects: string[]
  noscripts: string[]
}> {
  const cleanDomain = normalizeDomain(domain)
  const url = `https://${cleanDomain}`

  let html: string
  let headers: Record<string, string>

  try {
    const result = await fetchHTML(url, true)
    html = result.html
    headers = result.headers
    if (result.statusCode >= 400) {
      console.warn(`[MarTech] HTTP ${result.statusCode} fetching ${url}`)
    }
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr)
    const isSSL = msg.includes('certificate') || msg.includes('CERT') || msg.includes('SSL') || msg.includes('unable to verify')

    if (isSSL) {
      console.warn(`[MarTech] SSL error for ${cleanDomain}, retrying without strict verification...`)
      try {
        const result = await fetchHTML(url, false)
        html = result.html
        headers = result.headers
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
        throw new Error(`Impossibile raggiungere ${cleanDomain} anche senza verifica SSL: ${retryMsg}`)
      }
    } else if (msg.includes('timeout')) {
      throw new Error(`Timeout fetching ${cleanDomain} (20s). Il sito potrebbe essere lento o non raggiungibile.`)
    } else {
      throw new Error(`Impossibile raggiungere ${cleanDomain}: ${msg}`)
    }
  }

  const scriptSrcRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi
  const scripts: string[] = []
  let match
  while ((match = scriptSrcRegex.exec(html)) !== null) {
    scripts.push(match[1])
  }

  const inlineScriptRegex = /<script(?:\s[^>]*)?>([^<]{10,})<\/script>/gi
  while ((match = inlineScriptRegex.exec(html)) !== null) {
    const snippet = match[1].trim().slice(0, 150)
    if (snippet.length > 10) scripts.push(`[inline] ${snippet}`)
  }

  const linkRegex = /<link[^>]+href=["']([^"']+)["'][^>]*>/gi
  const links: string[] = []
  while ((match = linkRegex.exec(html)) !== null) {
    links.push(match[1])
  }

  const metaRegex = /<meta[^>]+>/gi
  const metas: string[] = []
  while ((match = metaRegex.exec(html)) !== null) {
    metas.push(match[0])
  }

  // Also extract JSON-LD blocks for schema.org detection
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const jsonLdBlocks: string[] = []
  while ((match = jsonLdRegex.exec(html)) !== null) {
    jsonLdBlocks.push(match[1].trim().slice(0, 500))
  }

  // Extract preconnect/preload hints for third-party detection
  const preconnectRegex = /<link[^>]+rel=["'](?:preconnect|dns-prefetch|preload)["'][^>]+href=["']([^"']+)["'][^>]*>/gi
  const preconnects: string[] = []
  while ((match = preconnectRegex.exec(html)) !== null) {
    preconnects.push(match[1])
  }

  // Extract noscript tags (often contain tracking pixels as <img>)
  const noscriptRegex = /<noscript[^>]*>([\s\S]*?)<\/noscript>/gi
  const noscriptContent: string[] = []
  while ((match = noscriptRegex.exec(html)) !== null) {
    const content = match[1].trim().slice(0, 200)
    if (content.length > 5) noscriptContent.push(content)
  }

  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
  const rawSnippet = headMatch ? headMatch[1].slice(0, 8000) : html.slice(0, 8000)

  return {
    scripts: scripts.slice(0, 120),
    links: links.slice(0, 80),
    metas: metas.slice(0, 60),
    headers,
    rawSnippet,
    jsonLd: jsonLdBlocks.slice(0, 10),
    preconnects: Array.from(new Set(preconnects)).slice(0, 30),
    noscripts: noscriptContent.slice(0, 15),
  }
}

/* ── Step 2: AI Classification (direct Anthropic API call) ── */
const CLASSIFICATION_SYSTEM = `You are a senior enterprise MarTech stack analyst performing a comprehensive technology audit for a consulting engagement (Accenture / Gartner level). Your analysis must be EXHAUSTIVE — identify EVERY externally observable technology, platform, service, SDK, pixel, and integration.

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
3. **Inline Scripts**: dataLayer pushes, pixel initialization (fbq, gtag, _satellite, analytics.track), global config objects (window.__NEXT_DATA__, Shopify.*, __NUXT__)
4. **Link/Stylesheet refs**: CDN origins, font services, theme paths (wp-content, /assets/themes/, /static/)
5. **Meta Tags**: generator, og:*, twitter:*, application-name, msapplication-*, apple-mobile-web-app, theme-color, viewport, robots, canonical, alternate hreflang, csp-nonce
6. **HTML structure**: data-* attributes, class naming patterns (wp-*, shopify-*, next-*, nuxt-*), noscript tags, comment signatures, preconnect/preload/prefetch hints, JSON-LD blocks

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

export interface DetectionUsage {
  input_tokens: number
  output_tokens: number
}

export async function classifyWithAI(
  domain: string,
  signals: Awaited<ReturnType<typeof fetchSiteSignals>>
): Promise<{ tools: DetectedTool[]; usage: DetectionUsage }> {
  const signalsSummary = `DOMAIN: ${domain}

RESPONSE HEADERS:
${Object.entries(signals.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}

SCRIPT SOURCES (${signals.scripts.length}):
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

HEAD HTML SNIPPET (first 8000 chars):
${signals.rawSnippet}`

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurata')

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    temperature: 0.1,
    system: CLASSIFICATION_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Perform an EXHAUSTIVE enterprise technology audit on the following website signals. Identify ALL technologies, platforms, SDKs, pixels, tracking scripts, CDNs, fonts, frameworks, and third-party services. This is for a senior consulting partner — completeness is critical. Return ONLY the JSON object, no markdown, no explanation.\n\n${signalsSummary}`,
      },
    ],
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
    throw new Error(`Anthropic API errore ${res.status}: ${errBody.slice(0, 200)}`)
  }

  const data = await res.json() as {
    content: Array<{ type: string; text?: string }>
    usage?: { input_tokens: number; output_tokens: number }
  }

  console.log(`[MarTech] API usage: ${data.usage?.input_tokens || '?'} in / ${data.usage?.output_tokens || '?'} out tokens`)

  // Extract text content
  const textBlock = data.content.find(b => b.type === 'text')
  if (!textBlock?.text) {
    throw new Error('Anthropic API: nessun testo nella risposta')
  }

  // Parse JSON from response (handle markdown code blocks)
  let jsonText = textBlock.text.trim()
  // Strip markdown code fences if present
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  let parsed: { tools: Array<{
    category: string
    tool_name: string
    tool_version: string | null
    confidence: number
    evidence: string
    sub_category?: string
  }> }

  try {
    parsed = JSON.parse(jsonText)
  } catch (parseErr) {
    console.error('[MarTech] Failed to parse AI response:', jsonText.slice(0, 500))
    throw new Error('Errore parsing risposta AI: JSON non valido')
  }

  if (!parsed.tools || !Array.isArray(parsed.tools)) {
    console.error('[MarTech] Unexpected response structure:', jsonText.slice(0, 500))
    throw new Error('Errore struttura risposta AI: manca il campo tools')
  }

  const usage: DetectionUsage = {
    input_tokens: data.usage?.input_tokens || 0,
    output_tokens: data.usage?.output_tokens || 0,
  }

  const tools = parsed.tools.map(t => ({
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

/* ── Combined: Detect Full Stack ── */
export async function detectMartechStack(domain: string): Promise<{ tools: DetectedTool[]; usage: DetectionUsage }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY non configurata. Aggiungi la chiave nelle variabili d\'ambiente.')
  }

  const cleanDomain = normalizeDomain(domain)
  console.log(`[MarTech] Starting detection for ${cleanDomain}`)

  const signals = await fetchSiteSignals(cleanDomain)
  console.log(`[MarTech] Fetched signals: ${signals.scripts.length} scripts, ${signals.links.length} links, ${signals.metas.length} metas, ${signals.jsonLd.length} JSON-LD, ${signals.preconnects.length} preconnects, ${signals.noscripts.length} noscripts`)

  const result = await classifyWithAI(cleanDomain, signals)
  console.log(`[MarTech] AI classified ${result.tools.length} tools`)
  return result
}
