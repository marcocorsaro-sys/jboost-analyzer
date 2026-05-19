/**
 * MarTech detection — LLM-native pipeline.
 *
 * Replaces the legacy `https`-module fetch (which fails on JS-challenged sites
 * like casaforte.it) with a Firecrawl headless-browser scrape, then feeds the
 * rendered page to Claude Sonnet 4.6 for end-to-end analysis (tools, gaps,
 * recommendations, maturity).
 *
 * Output shape is identical to `lib/martech/detect.ts#detectMartechStack`
 * (`DetectionResult`) so all call sites (the `/api/clients/[id]/martech`
 * route, the diagnostic `/api/martech-test`, and the analyzer phase 7) keep
 * working without changes.
 *
 * Toggle via env `USE_LLM_MARTECH=true`. The legacy hybrid pipeline remains
 * available and is the default until this proves out in production.
 */

import { scrapeWithFirecrawl, type FirecrawlScrapeResult } from '@/lib/integrations/providers/firecrawl/client'
import type {
  DetectedTool,
  DetectionResult,
  DetectionUsage,
  GapItem,
  Recommendation,
} from './detect'

const SONNET_MODEL = 'claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS = 8192

// Truncation budget for the LLM context. ~80K chars ≈ 20K tokens which leaves
// generous room for the system prompt + response within Sonnet's 200K window.
const HTML_TRUNCATE_CHARS = 80_000
const MARKDOWN_TRUNCATE_CHARS = 20_000

function normalizeDomain(raw: string): string {
  let d = raw.trim()
  d = d.replace(/^https?:\/\//, '')
  d = d.replace(/\/+$/, '')
  return d.split('/')[0]
}

function clampLen(s: string | null | undefined, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + `\n…[truncated, ${s.length - max} more chars]` : s
}

/**
 * System prompt is intentionally close to the legacy one for category-key
 * stability — downstream UI maps to a fixed set of MARTECH_CATEGORIES. Two
 * key differences: (1) we no longer mention web_search since Firecrawl gives
 * us the actual rendered page, (2) we ask the model to ground every tool
 * claim in concrete evidence from the supplied content.
 */
const MARTECH_LLM_SYSTEM = `You are an expert martech analyst. The user will give you a fully rendered web page (HTML + markdown view) for a single domain. Identify the marketing technology stack from concrete signals in the page: script src URLs, link rel hosts, meta tags, JSON-LD blocks, HTTP headers, inline dataLayer pushes, and visible UI widgets.

Your analysis must cover these technology categories:
- Tag Management (GTM, Tealium, Adobe Launch, ...)
- Analytics & Web Intelligence (GA4, Adobe Analytics, Mixpanel, Heap, Hotjar, Clarity, ...)
- CRM & Marketing Automation (HubSpot, Salesforce, Marketo, Pardot, Klaviyo, ...)
- CDP & Data Layer (Segment, mParticle, Tealium AudienceStream, ...)
- Advertising & Paid Media (Meta Pixel, LinkedIn Insight, Google Ads, DoubleClick, Criteo, ...)
- Personalization & Testing (Optimizely, VWO, Dynamic Yield, AB Tasty, ...)
- SEO & Content Intelligence (structured data presence, sitemaps, hreflang, ...)
- Chat & CX (Intercom, Drift, Zendesk, Salesforce Live Agent, Tawk.to, ...)
- Consent Management (OneTrust, Cookiebot, TrustArc, Iubenda, Didomi, ...)
- E-commerce & Commerce (Shopify, Magento, SAP Commerce, commercetools, ...)
- CMS / DXP (WordPress, Drupal, Adobe Experience Manager, Contentful, ...)
- Frontend Framework (React, Next.js, Vue, Angular, jQuery, ...)
- Hosting & CDN (AWS, Vercel, Cloudflare, Akamai, Fastly, ...)
- Security & WAF (Cloudflare WAF, Akamai, Imperva, reCAPTCHA, ...)
- Performance Monitoring (New Relic, Datadog, Sentry, SpeedCurve, ...)
- Fonts & Media (Google Fonts, Adobe Fonts, Cloudinary, ...)
- Payment (Stripe, PayPal, Adyen, Klarna, ...)
- Accessibility (AccessiBe, UserWay, ...)
- UX & Widgets (Trustpilot, reviews, popups, push notifications, ...)

CATEGORY KEYS to use (exactly):
cms, ecommerce, frontend_framework, hosting, analytics, tag_manager, customer_data, session_recording, ab_testing, ad_platforms, seo, social, marketing_automation, email_platform, crm, affiliate, personalization, chat_support, consent_management, accessibility, fonts_media, ux_widgets, cdn, performance, security, dns, image_optimization, error_monitoring, payment, other

GROUNDING RULE: every tool you list must have an "evidence" string that quotes or paraphrases the specific signal (e.g. "script src=googletagmanager.com/gtag/js?id=G-XXX", "JSON-LD @type=Organization with sameAs LinkedIn", "Cookiebot div#CybotCookiebotDialog"). If you can't point at a concrete signal, OMIT the tool.

Confidence scale:
- 0.90+ = explicit script/tag/header/cookie match in the supplied content
- 0.70-0.89 = strong indirect signal (e.g. CSP header lists a known SaaS host)
- 0.50-0.69 = inferred from one weak signal — use sparingly

MATURITY SCORE (0-100) tiers: 0-25 Basic / 26-50 Developing / 51-75 Advanced / 76-100 Best-in-Class. Score based on stack completeness, presence of CDP/data layer, consent management, testing & personalization capability.

GAP ANALYSIS: missing categories or weak points vs industry best practice for the apparent business type. Severity high/medium/low.

RECOMMENDATIONS: 3-5 prioritized actionable suggestions.

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown fences, no commentary):
{
  "tools": [
    { "category": "<key>", "tool_name": "<name>", "tool_version": "<version_or_null>", "confidence": <0.0-1.0>, "evidence": "<concrete_signal>" }
  ],
  "maturity_score": <0-100>,
  "maturity_tier": "Basic|Developing|Advanced|Best-in-Class",
  "gap_analysis": [
    { "category": "<key>", "label": "<readable>", "severity": "high|medium|low", "description": "<why>" }
  ],
  "recommendations": [
    { "priority": <1-5>, "title": "<short>", "description": "<actionable>", "category": "<key>" }
  ]
}`

interface ParsedAIPayload {
  tools: Array<{
    category?: string
    tool_name?: string
    tool_version?: string | null
    confidence?: number
    evidence?: string
  }>
  maturity_score: number
  maturity_tier: string
  gap_analysis: GapItem[]
  recommendations: Recommendation[]
}

function parseAIResponse(text: string): ParsedAIPayload {
  // Try direct JSON parse; if that fails, strip code fences then parse.
  let raw = text.trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  }
  try {
    const parsed = JSON.parse(raw)
    return {
      tools: Array.isArray(parsed.tools) ? parsed.tools : [],
      maturity_score: typeof parsed.maturity_score === 'number' ? parsed.maturity_score : 0,
      maturity_tier: typeof parsed.maturity_tier === 'string' ? parsed.maturity_tier : 'Basic',
      gap_analysis: Array.isArray(parsed.gap_analysis) ? parsed.gap_analysis : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    }
  } catch {
    // The model occasionally wraps JSON in narrative prose. Try to locate the
    // outermost {...} block and parse that.
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1))
        return {
          tools: Array.isArray(parsed.tools) ? parsed.tools : [],
          maturity_score: typeof parsed.maturity_score === 'number' ? parsed.maturity_score : 0,
          maturity_tier: typeof parsed.maturity_tier === 'string' ? parsed.maturity_tier : 'Basic',
          gap_analysis: Array.isArray(parsed.gap_analysis) ? parsed.gap_analysis : [],
          recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        }
      } catch {
        // fallthrough
      }
    }
    return { tools: [], maturity_score: 0, maturity_tier: 'Basic', gap_analysis: [], recommendations: [] }
  }
}

async function callSonnet(
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; usage: DetectionUsage }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${errBody.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>
    usage?: { input_tokens: number; output_tokens: number }
  }

  const textBlock = data.content.find(b => b.type === 'text')
  if (!textBlock?.text) throw new Error('Anthropic API: no text in response')

  return {
    text: textBlock.text,
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    },
  }
}

function buildUserMessage(domain: string, scrape: FirecrawlScrapeResult): string {
  const meta = scrape.metadata ?? {}
  const metaLines = Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v.slice(0, 250) : JSON.stringify(v).slice(0, 250)}`)
    .join('\n')

  return [
    `# Domain: ${domain}`,
    '',
    '## Page metadata',
    metaLines || '  (no metadata extracted)',
    '',
    '## Rendered HTML (post-JavaScript execution, Firecrawl)',
    '```html',
    clampLen(scrape.html, HTML_TRUNCATE_CHARS),
    '```',
    '',
    '## Markdown view (cleaned by Firecrawl)',
    '```markdown',
    clampLen(scrape.markdown, MARKDOWN_TRUNCATE_CHARS),
    '```',
    '',
    'Analyze this content and return the JSON described in the system prompt. Remember the grounding rule: every tool entry must cite a concrete signal from the content above.',
  ].join('\n')
}

/**
 * LLM-native MarTech detector. Returns the same `DetectionResult` shape as
 * the legacy hybrid path so callers don't branch on the source.
 */
export async function detectMartechStackLlm(domain: string): Promise<DetectionResult> {
  const cleanDomain = normalizeDomain(domain)
  console.log(`[MarTech-LLM] ═══ Starting Firecrawl+Sonnet detection for ${cleanDomain} ═══`)

  // Step 1: Firecrawl scrape of the homepage.
  const scrape = await scrapeWithFirecrawl(`https://${cleanDomain}`, {
    formats: ['html', 'markdown'],
    waitFor: 8000,
  })

  if (!scrape.ok) {
    // We don't throw — the panel surfaces this as a diagnostic, the same way
    // DataForSEO failures already do in the legacy path.
    return {
      tools: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      completeness: {
        score: 0,
        level: 'incomplete',
        pagesScanned: 0,
        totalSignals: 0,
        diagnostics: [
          { type: 'error', message: `Firecrawl scrape failed: ${scrape.status}${scrape.detail ? ' — ' + scrape.detail : ''}` },
        ],
        signalQuality: {
          scripts: 0, links: 0, metas: 0, htmlSize: 0,
          jsonLd: 0, preconnects: 0, noscripts: 0, iframes: 0, dataAttributes: 0,
        },
      },
      maturityScore: 0,
      maturityTier: 'Basic',
      gapAnalysis: [],
      recommendations: [],
    }
  }

  const htmlLen = scrape.html?.length ?? 0
  const mdLen = scrape.markdown?.length ?? 0
  console.log(`[MarTech-LLM] Firecrawl OK: ${htmlLen} chars HTML, ${mdLen} chars markdown, ${scrape.credits_used} credit(s)`)

  // Step 2: LLM analysis.
  const userMessage = buildUserMessage(cleanDomain, scrape)
  let parsed: ParsedAIPayload
  let usage: DetectionUsage = { input_tokens: 0, output_tokens: 0 }
  try {
    const llmRes = await callSonnet(MARTECH_LLM_SYSTEM, userMessage)
    usage = llmRes.usage
    parsed = parseAIResponse(llmRes.text)
    console.log(`[MarTech-LLM] AI usage: ${usage.input_tokens} in / ${usage.output_tokens} out tokens, ${parsed.tools.length} tools, maturity ${parsed.maturity_score}/100 (${parsed.maturity_tier})`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[MarTech-LLM] LLM call failed:`, message)
    return {
      tools: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      completeness: {
        score: 0,
        level: 'incomplete',
        pagesScanned: 1,
        totalSignals: 0,
        diagnostics: [
          { type: 'success', message: `Firecrawl scrape ok (${htmlLen} chars HTML)` },
          { type: 'error', message: `LLM analysis failed: ${message}` },
        ],
        signalQuality: {
          scripts: 0, links: 0, metas: 0, htmlSize: htmlLen,
          jsonLd: 0, preconnects: 0, noscripts: 0, iframes: 0, dataAttributes: 0,
        },
      },
      maturityScore: 0,
      maturityTier: 'Basic',
      gapAnalysis: [],
      recommendations: [],
    }
  }

  // Step 3: Map LLM payload to DetectionResult shape.
  const tools: DetectedTool[] = parsed.tools
    .filter(t => t.tool_name && t.category)
    .map(t => ({
      category: t.category as string,
      tool_name: t.tool_name as string,
      tool_version: t.tool_version ?? null,
      confidence: typeof t.confidence === 'number' ? t.confidence : 0.5,
      details: {
        source: 'firecrawl_sonnet',
        evidence: t.evidence ?? '',
      },
    }))

  const gapAnalysis: GapItem[] = parsed.gap_analysis.map(g => ({
    category: g.category,
    label: g.label,
    severity: g.severity,
    description: g.description,
  }))

  const recommendations: Recommendation[] = parsed.recommendations
    .map(r => ({
      priority: typeof r.priority === 'number' ? r.priority : 3,
      title: r.title,
      description: r.description,
      category: r.category,
    }))
    .sort((a, b) => a.priority - b.priority)

  let maturityScore = Math.max(0, Math.min(100, Math.round(parsed.maturity_score)))
  let maturityTier: DetectionResult['maturityTier']
  if (maturityScore <= 25) maturityTier = 'Basic'
  else if (maturityScore <= 50) maturityTier = 'Developing'
  else if (maturityScore <= 75) maturityTier = 'Advanced'
  else maturityTier = 'Best-in-Class'

  // Completeness in the new pipeline is binary-ish: did Firecrawl give us a
  // rendered page that the LLM could grind on? If yes, completeness = good.
  // signalQuality numbers are approximate (we don't pattern-extract anymore).
  const completeness: DetectionResult['completeness'] = {
    score: tools.length > 0 ? 85 : 40,
    level: tools.length === 0 ? 'incomplete' : tools.length < 5 ? 'partial' : tools.length < 10 ? 'good' : 'complete',
    pagesScanned: 1,
    totalSignals: tools.length,
    diagnostics: [
      { type: 'success', message: `Firecrawl rendered the page (${htmlLen} chars HTML, ${mdLen} chars markdown)` },
      { type: 'info', message: `Sonnet 4.6 identified ${tools.length} tools, ${gapAnalysis.length} gaps, ${recommendations.length} recommendations` },
      { type: 'info', message: `LLM token usage: ${usage.input_tokens} in / ${usage.output_tokens} out` },
    ],
    signalQuality: {
      scripts: 0,
      links: 0,
      metas: 0,
      htmlSize: htmlLen,
      jsonLd: 0,
      preconnects: 0,
      noscripts: 0,
      iframes: 0,
      dataAttributes: 0,
    },
  }

  console.log(`[MarTech-LLM] ═══ Final: ${tools.length} tools, maturity ${maturityScore}/100 (${maturityTier}) ═══`)

  return {
    tools,
    usage,
    completeness,
    maturityScore,
    maturityTier,
    gapAnalysis,
    recommendations,
  }
}
