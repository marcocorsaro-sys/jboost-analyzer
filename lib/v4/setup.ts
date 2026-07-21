/**
 * V4 setup — the shape of an analysis before it runs, and its validation.
 *
 * Kept out of the route so the rules can be tested without HTTP, and out of
 * the component so the browser cannot be the only thing enforcing them.
 *
 * The planner (lib/v4/runner/planner) owns the driver-level gating; this
 * module owns everything upstream of it: the site set, the setup fields and
 * the page templates.
 */

import { normalizeDomain } from '@/lib/v4/runner/store'
import type { AnalysisSite, SiteRef, TemplateConfig } from '@/lib/v4/runner/types'

/** Page templates of sheet 1, in the order the wizard shows them. */
export const TEMPLATE_KEYS = [
  'homepage',
  'plp',
  'pdp',
  'article',
  'listing_articles',
  'service_page',
  'about',
  'faq',
  'global',
] as const
export type TemplateKey = (typeof TEMPLATE_KEYS)[number]

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  homepage: 'Homepage',
  plp: 'Listing prodotti (PLP)',
  pdp: 'Scheda prodotto (PDP)',
  article: 'Articolo',
  listing_articles: 'Listing articoli',
  service_page: 'Pagina servizio',
  about: 'Chi siamo',
  faq: 'FAQ',
  global: 'Globale / altro',
}

export const INDUSTRY_PRESETS = [
  'retail_luxury',
  'banking_finance',
  'media_publishing',
  'travel_hospitality',
  'b2b_services',
  'pharma_healthcare',
  'home_appliances',
] as const
export type IndustryPreset = (typeof INDUSTRY_PRESETS)[number]

export const INDUSTRY_LABELS: Record<IndustryPreset, string> = {
  retail_luxury: 'Retail / Luxury',
  banking_finance: 'Banking / Finance',
  media_publishing: 'Media / Publishing',
  travel_hospitality: 'Travel / Hospitality',
  b2b_services: 'B2B Services',
  pharma_healthcare: 'Pharma / Healthcare',
  home_appliances: 'Home Appliances',
}

export interface SetupSiteInput {
  domain: string
  brandName?: string | null
  brandVariants?: string[]
}

export interface SetupInput {
  clientId?: string | null
  client: SetupSiteInput
  competitors: SetupSiteInput[]
  country: string
  outputLanguage: 'it' | 'en'
  industryPreset?: IndustryPreset | null
  siteType?: string | null
  targetAudience?: string | null
  seoMaturity?: 'low' | 'medium' | 'high' | null
  drivers: string[]
  /** site_ref -> template_key -> URL. Blank/missing = template absent. */
  templates?: Record<string, Record<string, string>>
}

export interface SetupValidation {
  sites: AnalysisSite[]
  templates: TemplateConfig[]
  errors: string[]
}

/**
 * Turn raw wizard input into the site set + templates, collecting every
 * problem instead of failing on the first one — a setup form should tell the
 * analyst everything that is wrong in one pass.
 */
export function buildSetup(input: SetupInput): SetupValidation {
  const errors: string[] = []

  const clientDomain = normalizeDomain(input.client?.domain ?? '')
  if (!clientDomain) errors.push('il dominio del cliente è obbligatorio')

  const sites: AnalysisSite[] = []
  if (clientDomain) {
    sites.push({
      site_ref: 'client',
      domain: clientDomain,
      name: input.client.brandName || clientDomain,
      is_client: true,
      brand_name: input.client.brandName ?? null,
      brand_variants: cleanVariants(input.client.brandVariants),
    })
  }

  const competitors = (input.competitors ?? [])
    .map((c) => ({ ...c, domain: normalizeDomain(c.domain ?? '') }))
    .filter((c) => c.domain)

  if (competitors.length > 4) {
    errors.push(`al massimo 4 competitor (ricevuti ${competitors.length})`)
  }

  const seen = new Set<string>([clientDomain])
  competitors.slice(0, 4).forEach((c, i) => {
    if (seen.has(c.domain)) {
      errors.push(`dominio duplicato nel set: ${c.domain}`)
      return
    }
    seen.add(c.domain)
    sites.push({
      site_ref: `competitor_${i + 1}` as SiteRef,
      domain: c.domain,
      name: c.brandName || c.domain,
      is_client: false,
      brand_name: c.brandName ?? null,
      brand_variants: cleanVariants(c.brandVariants),
    })
  })

  if (!input.drivers || input.drivers.length === 0) {
    errors.push('seleziona almeno un driver')
  }
  if (input.outputLanguage !== 'it' && input.outputLanguage !== 'en') {
    errors.push("la lingua di output deve essere 'it' o 'en'")
  }
  if (input.industryPreset && !INDUSTRY_PRESETS.includes(input.industryPreset)) {
    errors.push(`industry preset non valido: ${input.industryPreset}`)
  }

  const templates = buildTemplates(sites, input.templates ?? {}, errors)

  return { sites, templates, errors }
}

function cleanVariants(values?: string[]): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean)
}

/**
 * Templates, defaulted so a run is always possible.
 *
 * Every site gets a homepage: it is the one page we can derive from the
 * domain without guessing, and without it the page-based drivers would have
 * nothing to measure. Any other template is only stored when the analyst
 * actually gave a URL — an invented /products URL would be a measurement of
 * a 404.
 */
export function buildTemplates(
  sites: AnalysisSite[],
  raw: Record<string, Record<string, string>>,
  errors: string[],
): TemplateConfig[] {
  const out: TemplateConfig[] = []

  for (const site of sites) {
    const given = raw[site.site_ref] ?? {}
    const homepage = (given.homepage ?? '').trim() || `https://${site.domain}`

    for (const key of TEMPLATE_KEYS) {
      const value = key === 'homepage' ? homepage : (given[key] ?? '').trim()
      if (!value) continue

      if (!isHttpUrl(value)) {
        errors.push(`URL non valida per ${site.domain} · ${TEMPLATE_LABELS[key]}: ${value}`)
        continue
      }
      out.push({
        site_ref: site.site_ref,
        template_key: key,
        url: value,
        applies_to: ['speed', 'accessibility', 'schema', 'content'],
      })
    }
  }

  return out
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
