// Pre-sales intake — URL → Firecrawl scrape + Sonnet extraction.
//
// One Firecrawl scrape of the homepage, then Sonnet reads the rendered
// HTML/markdown and pulls out: company name, country, language,
// industry, plus 4 competitor suggestions. Designed to power the
// /pre-sales/new "URL only" form: type a domain, get every field
// pre-filled, edit anything before saving.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { scrapeWithFirecrawl } from '@/lib/integrations/providers/firecrawl/client'
import { enforceSpendLimit } from '@/lib/tracking/spend-limit'

export const maxDuration = 90
export const dynamic = 'force-dynamic'

const SONNET_MODEL = 'claude-sonnet-5'
const MAX_OUTPUT_TOKENS = 1200

interface IntakeResult {
  name: string
  domain: string
  country: 'IT' | 'US' | 'DE' | 'FR' | 'ES' | 'UK'
  language: 'it' | 'en' | 'de' | 'fr' | 'es'
  industry: string | null
  competitors: string[]
  /** Set when one of the LLM/Firecrawl branches degraded gracefully. */
  warnings: string[]
}

function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '')
  d = d.replace(/^www\./, '')
  d = d.replace(/\/.*$/, '')
  return d
}

const SYSTEM_PROMPT = `You read a rendered web page (HTML + markdown) and produce a structured intake record for a B2B SEO platform.

Output ONLY valid JSON, no markdown fences, no commentary. Schema:
{
  "name": string,                // short brand/company name. Strip "S.p.A.", "S.r.l.", country suffixes.
  "country": "IT"|"US"|"DE"|"FR"|"ES"|"UK",   // best-guess primary market — use ccTLD, "lang" attribute, address, currency.
  "language": "it"|"en"|"de"|"fr"|"es",        // page language. UK pages → "en".
  "industry": string | null,     // 1-3 word industry tag (e.g. "Fashion E-commerce", "B2B SaaS", "Hotel Group"). Null if unclear.
  "competitors": [
    string                       // 4 plausible competitor DOMAINS for this brand in the same country/sector.
                                 // Use real domains you actually know exist; do not invent. Avoid the brand itself.
                                 // No protocol, no "www.", lowercase. Order: most relevant first.
  ]
}

Rules:
- "competitors" must contain EXACTLY 4 entries when you have any confidence; if you genuinely have no idea, return [].
- Never include the page's own domain in competitors.
- Prefer narrower, more direct competitors over giant aggregators.
- If the page is a JS challenge / Cloudflare wall and you cannot read content, fall back to ccTLD-based country guess and return industry=null, competitors=[].`

interface ParsedIntake {
  name?: string
  country?: string
  language?: string
  industry?: string | null
  competitors?: string[]
}

const ALLOWED_COUNTRIES = new Set(['IT', 'US', 'DE', 'FR', 'ES', 'UK'])
const ALLOWED_LANGS = new Set(['it', 'en', 'de', 'fr', 'es'])

function parseJson(text: string): ParsedIntake {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  }
  // Locate outermost {} if model wrapped JSON in narrative.
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1)
  try {
    return JSON.parse(cleaned) as ParsedIntake
  } catch {
    return {}
  }
}

function fallbackCountryFromDomain(domain: string): { country: IntakeResult['country']; language: IntakeResult['language'] } {
  const tld = domain.split('.').pop()?.toLowerCase() ?? ''
  if (tld === 'it') return { country: 'IT', language: 'it' }
  if (tld === 'de' || tld === 'at') return { country: 'DE', language: 'de' }
  if (tld === 'fr') return { country: 'FR', language: 'fr' }
  if (tld === 'es') return { country: 'ES', language: 'es' }
  if (tld === 'uk' || tld === 'co.uk') return { country: 'UK', language: 'en' }
  return { country: 'US', language: 'en' }
}

function nameFromDomain(domain: string): string {
  const root = domain.split('.')[0] || domain
  // 'casaforte' → 'Casaforte', 'replayjeans' → 'Replayjeans'
  return root.charAt(0).toUpperCase() + root.slice(1)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const limited = await enforceSpendLimit(supabase)
  if (limited) return limited

  let body: { url?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.url || typeof body.url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }
  const domain = normalizeDomain(body.url)
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return NextResponse.json({ error: `"${body.url}" doesn't look like a domain or URL` }, { status: 400 })
  }

  const warnings: string[] = []
  const fallback = fallbackCountryFromDomain(domain)

  // 1. Firecrawl scrape (homepage, html+markdown). Soft-degrade on failure.
  const scrape = await scrapeWithFirecrawl(`https://${domain}`, {
    formats: ['html', 'markdown'],
    waitFor: 5000,
  })
  if (!scrape.ok) {
    warnings.push(`Firecrawl ${scrape.status}: ${scrape.detail ?? 'no detail'}`)
  }

  // 2. Sonnet extracts intake — only if we have content AND a key.
  const apiKey = process.env.ANTHROPIC_API_KEY
  let parsed: ParsedIntake = {}
  if (apiKey && (scrape.html || scrape.markdown)) {
    try {
      const userPrompt =
        `Domain: ${domain}\n\n` +
        `Page metadata (Firecrawl):\n${JSON.stringify(scrape.metadata ?? {}, null, 2).slice(0, 4000)}\n\n` +
        `Page markdown (truncated):\n${(scrape.markdown ?? '').slice(0, 12000)}\n\n` +
        `Page HTML head (truncated):\n${(scrape.html ?? '').slice(0, 6000)}\n\n` +
        `Return the JSON intake now.`
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 30_000)
      try {
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
            // Sonnet 5 thinks by default; this is structured extraction on a
            // tight budget, so keep the pre-migration behaviour.
            thinking: { type: 'disabled' },
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
          }),
          signal: ctrl.signal,
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          warnings.push(`Anthropic ${res.status}: ${text.slice(0, 150)}`)
        } else {
          const data = await res.json()
          const text = data?.content?.[0]?.text
          if (typeof text === 'string') parsed = parseJson(text)
        }
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      warnings.push(`LLM extraction failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else if (!apiKey) {
    warnings.push('ANTHROPIC_API_KEY not configured — name/competitors not extracted')
  }

  // 3. Sanitize + apply fallbacks. Never return garbage to the form.
  const name = (parsed.name && parsed.name.trim()) || nameFromDomain(domain)

  const country = (parsed.country && ALLOWED_COUNTRIES.has(parsed.country.toUpperCase())
    ? parsed.country.toUpperCase()
    : fallback.country) as IntakeResult['country']

  const language = (parsed.language && ALLOWED_LANGS.has(parsed.language.toLowerCase())
    ? parsed.language.toLowerCase()
    : fallback.language) as IntakeResult['language']

  const industry = (typeof parsed.industry === 'string' && parsed.industry.trim())
    ? parsed.industry.trim()
    : null

  const competitors: string[] = []
  if (Array.isArray(parsed.competitors)) {
    for (const c of parsed.competitors) {
      if (typeof c !== 'string') continue
      const cd = normalizeDomain(c)
      if (!cd || cd === domain) continue
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cd)) continue
      if (competitors.includes(cd)) continue
      competitors.push(cd)
      if (competitors.length >= 4) break
    }
  }

  const result: IntakeResult = {
    name,
    domain,
    country,
    language,
    industry,
    competitors,
    warnings,
  }
  return NextResponse.json(result)
}
