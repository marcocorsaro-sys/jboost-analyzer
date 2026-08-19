export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

/**
 * POST /api/v4/analyses/suggest — AI-assisted setup prefill for the V4 wizard.
 *
 * Adaptation of the V1 "Suggerisci con AI" (app/api/pre-sales/intake — one
 * Firecrawl scrape of the homepage + one Sonnet extraction), extended to the
 * V4 setup fields: brand + variants, site type, sector/industry preset, 3-4
 * plausible competitors {domain, brand_name}, 3-10 thematic clusters, and one
 * example URL per recognisable page template.
 *
 * Rules of the house, all enforced here:
 *  - spend limit BEFORE the LLM call (enforceSpendLimit, 402 when capped);
 *  - usage logged to llm_usage (trackLlmUsage) like every other LLM call;
 *  - the LLM call goes through callAnthropicWithUsage (the shared V4 client);
 *  - template URLs are NEVER invented (Block 3): they come exclusively from
 *    the site's own sitemap (lib/schema/discover). No sitemap → no URLs.
 *
 * Everything returned is a PREFILL: the wizard writes it into empty fields
 * only, the analyst reviews and confirms — nothing is auto-saved.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { scrapeWithFirecrawl } from '@/lib/integrations/providers/firecrawl/client'
import { enforceSpendLimit } from '@/lib/tracking/spend-limit'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'
import { callAnthropicWithUsage } from '@/lib/v4/drivers/jhorizon-extract'
import { fetchSitemapUrls, classifyUrl } from '@/lib/schema/discover'
import {
  INDUSTRY_PRESETS,
  SITE_TYPES,
  CLUSTERS_MAX,
  CLUSTERS_MIN,
  type IndustryPreset,
  type SiteType,
  type TemplateKey,
} from '@/lib/v4/setup'

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/

export interface SuggestResponse {
  domain: string
  brandName: string | null
  brandVariants: string[]
  siteType: SiteType | null
  industryPreset: IndustryPreset | null
  sector: string | null
  competitors: Array<{ domain: string; brandName: string }>
  thematicClusters: string[]
  /** template_key -> one example URL, straight from the site's sitemap. */
  templateUrls: Partial<Record<TemplateKey, string>>
  /** Every branch that degraded gracefully, spelled out. */
  warnings: string[]
}

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

function brandFromDomain(domain: string): string {
  const root = domain.split('.')[0] || domain
  return root.charAt(0).toUpperCase() + root.slice(1)
}

// ---------------------------------------------------------------------------
// LLM extraction — fixed JSON schema, enums from lib/v4/setup so the two
// catalogs can never drift.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You read a brand's homepage (metadata + markdown) and produce a structured setup suggestion for a competitive SEO audit.

Output ONLY valid JSON, no markdown fences, no commentary. Schema:
{
  "brand_name": string | null,          // short brand name; strip "S.p.A.", "S.r.l.", legal suffixes
  "brand_variants": string[],           // 0-4 common variants used in searches (e.g. "united colors of benetton"); [] if none known
  "site_type": ${JSON.stringify([...SITE_TYPES])} pick ONE or null,
  "industry_preset": ${JSON.stringify([...INDUSTRY_PRESETS])} pick ONE or null,
  "sector": string | null,              // 1-3 word free-text industry tag (e.g. "Fashion E-commerce"); null if unclear
  "competitors": [                      // 3-4 plausible DIRECT competitors in the same country/sector
    { "domain": string,                 // real domains you actually know exist; no protocol, no "www.", lowercase
      "brand_name": string }
  ],
  "thematic_clusters": string[]         // ${CLUSTERS_MIN}-${CLUSTERS_MAX} NON-brand macro-themes the brand should rank for
                                        // (e.g. for a cruise line: "Destinations", "Ships", "Onboard life")
}

Rules:
- Never invent: null / [] beats a guess. Competitor domains must be ones you know exist; never include the brand's own domain; prefer direct competitors over giant aggregators.
- thematic_clusters are macro-themes for non-brand SEO, in the language of the brand's primary market.
- If the page is unreadable (JS challenge, Cloudflare wall) rely only on what you reliably know about the domain itself; when in doubt return nulls.`

interface ParsedSuggestion {
  brand_name?: unknown
  brand_variants?: unknown
  site_type?: unknown
  industry_preset?: unknown
  sector?: unknown
  competitors?: unknown
  thematic_clusters?: unknown
}

function parseJson(text: string): ParsedSuggestion {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return {}
  try {
    return JSON.parse(text.slice(start, end + 1)) as ParsedSuggestion
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Template URLs from the sitemap — never invented (Block 3). One example URL
// per recognisable template; unrecognised roles are simply omitted.
// ---------------------------------------------------------------------------

const ROLE_TO_TEMPLATE: Record<string, TemplateKey> = {
  product: 'pdp',
  category: 'plp',
  article: 'article',
  blog: 'article',
  news: 'article',
  faq: 'faq',
  about: 'about',
}

async function suggestTemplateUrls(
  domain: string,
  warnings: string[],
): Promise<Partial<Record<TemplateKey, string>>> {
  try {
    const urls = await fetchSitemapUrls(`https://${domain}`)
    if (urls.length === 0) {
      warnings.push('sitemap non trovata o vuota: nessuna URL di template suggerita')
      return {}
    }
    const bare = domain.replace(/^www\./, '')
    const origin = `https://${domain}`
    const out: Partial<Record<TemplateKey, string>> = {}
    for (const u of urls) {
      let host: string
      try {
        host = new URL(u).hostname.toLowerCase().replace(/^www\./, '')
      } catch {
        continue
      }
      // Same site only (apex/www and subdomains of the client's domain).
      if (host !== bare && !host.endsWith(`.${bare}`)) continue
      const key = ROLE_TO_TEMPLATE[classifyUrl(u, origin)]
      if (key && !out[key]) out[key] = u
      if (Object.keys(out).length >= Object.keys(ROLE_TO_TEMPLATE).length) break
    }
    if (Object.keys(out).length === 0) {
      warnings.push('sitemap letta ma nessun template riconoscibile (pdp/plp/article/faq/about)')
    }
    return out
  } catch (err) {
    warnings.push(`discovery sitemap fallita: ${err instanceof Error ? err.message : String(err)}`)
    return {}
  }
}

// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Spend limit BEFORE any paid call — same contract as every LLM route.
  const limited = await enforceSpendLimit(supabase)
  if (limited) return limited

  let body: { domain?: unknown; country?: unknown } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'JSON body non valido' }, { status: 400 })
  }
  if (typeof body.domain !== 'string' || body.domain.trim() === '') {
    return NextResponse.json({ error: 'domain è obbligatorio' }, { status: 400 })
  }
  const domain = normalizeDomain(body.domain)
  if (!DOMAIN_RE.test(domain)) {
    return NextResponse.json(
      { error: `"${body.domain}" non sembra un dominio valido` },
      { status: 400 },
    )
  }
  const country = typeof body.country === 'string' && body.country.trim() !== '' ? body.country.trim().toUpperCase() : null

  const warnings: string[] = []

  // Firecrawl scrape + sitemap discovery run in parallel: independent sources.
  const [scrape, templateUrls] = await Promise.all([
    scrapeWithFirecrawl(`https://${domain}`, { formats: ['html', 'markdown'], waitFor: 5000 }),
    suggestTemplateUrls(domain, warnings),
  ])
  if (!scrape.ok) {
    warnings.push(`Firecrawl ${scrape.status}: ${scrape.detail ?? 'no detail'}`)
  }

  // One Sonnet call through the shared V4 client (usage comes back with the
  // text). Even with a failed scrape the model may reliably know the brand;
  // the system prompt forbids guessing, so an unknown domain yields nulls.
  let parsed: ParsedSuggestion = {}
  try {
    const userPrompt =
      `Domain: ${domain}\n` +
      (country ? `Primary analysis market (ISO): ${country}\n` : '') +
      `\nPage metadata (Firecrawl):\n${JSON.stringify(scrape.metadata ?? {}, null, 2).slice(0, 4000)}\n\n` +
      `Page markdown (truncated):\n${(scrape.markdown ?? '').slice(0, 10000)}\n\n` +
      `Return the JSON setup suggestion now.`
    const call = await callAnthropicWithUsage(userPrompt, 'V4 setup suggest', {
      system: SYSTEM_PROMPT,
      maxTokens: 1500,
      timeoutMs: 45_000,
    })
    parsed = parseJson(call.text)
    // Mandatory usage log — same table + cost source as the insight orchestrator.
    await trackLlmUsage({
      userId: user.id,
      provider: 'anthropic',
      model: call.model,
      operation: 'v4_setup_suggest',
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      metadata: { domain, country },
    })
  } catch (err) {
    warnings.push(`estrazione LLM fallita: ${err instanceof Error ? err.message : String(err)}`)
  }

  // --- sanitize: never return garbage to the form --------------------------
  const brandName =
    typeof parsed.brand_name === 'string' && parsed.brand_name.trim() !== ''
      ? parsed.brand_name.trim()
      : brandFromDomain(domain)

  const brandVariants = Array.isArray(parsed.brand_variants)
    ? parsed.brand_variants
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .map((v) => v.trim())
        .slice(0, 4)
    : []

  const siteType = SITE_TYPES.includes(parsed.site_type as SiteType) ? (parsed.site_type as SiteType) : null
  const industryPreset = INDUSTRY_PRESETS.includes(parsed.industry_preset as IndustryPreset)
    ? (parsed.industry_preset as IndustryPreset)
    : null
  const sector = typeof parsed.sector === 'string' && parsed.sector.trim() !== '' ? parsed.sector.trim() : null

  const competitors: Array<{ domain: string; brandName: string }> = []
  if (Array.isArray(parsed.competitors)) {
    for (const c of parsed.competitors) {
      if (!c || typeof c !== 'object') continue
      const cd = normalizeDomain(String((c as { domain?: unknown }).domain ?? ''))
      if (!cd || cd === domain || !DOMAIN_RE.test(cd)) continue
      if (competitors.some((x) => x.domain === cd)) continue
      const cb = (c as { brand_name?: unknown }).brand_name
      competitors.push({
        domain: cd,
        brandName: typeof cb === 'string' && cb.trim() !== '' ? cb.trim() : brandFromDomain(cd),
      })
      if (competitors.length >= 4) break
    }
  }

  let thematicClusters = Array.isArray(parsed.thematic_clusters)
    ? parsed.thematic_clusters
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .map((v) => v.trim())
        .slice(0, CLUSTERS_MAX)
    : []
  // The wizard validates 3-10 or none: fewer than 3 suggestions are worse
  // than none (they would immediately trip the validation).
  if (thematicClusters.length > 0 && thematicClusters.length < CLUSTERS_MIN) {
    warnings.push(`solo ${thematicClusters.length} cluster suggeriti (minimo ${CLUSTERS_MIN}): omessi`)
    thematicClusters = []
  }

  const result: SuggestResponse = {
    domain,
    brandName,
    brandVariants,
    siteType,
    industryPreset,
    sector,
    competitors,
    thematicClusters,
    templateUrls,
    warnings,
  }
  return NextResponse.json(result)
}
