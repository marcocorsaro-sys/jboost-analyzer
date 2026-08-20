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

import { V4_BUSINESS_DRIVERS } from '@/lib/scoring/registry'
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

/** Site type dropdown of Bibbia 04 sheet "New Audit (Setup)", field #5. */
export const SITE_TYPES = ['ecommerce', 'editorial', 'corporate_showcase', 'b2b', 'b2c'] as const
export type SiteType = (typeof SITE_TYPES)[number]

export const SITE_TYPE_LABELS: Record<SiteType, string> = {
  ecommerce: 'E-commerce',
  editorial: 'Editorial',
  corporate_showcase: 'Corporate / Showcase',
  b2b: 'B2B',
  b2c: 'B2C',
}

/** Target audience toggle of field #7: B2B / B2C / both. */
export const TARGET_AUDIENCE_MODES = ['b2b', 'b2c', 'both'] as const
export type TargetAudienceMode = (typeof TARGET_AUDIENCE_MODES)[number]

/**
 * Analysis-country options (field #4, multi dropdown). ISO codes because the
 * SEO API layer (Ahrefs/Similarweb) takes country codes; labels are display
 * only. The first selected country is the primary one written to
 * analyses.country so every existing driver keeps working unchanged.
 */
export const ANALYSIS_COUNTRIES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'IT', label: 'Italia' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Deutschland' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'España' },
  { code: 'PT', label: 'Portugal' },
  { code: 'NL', label: 'Nederland' },
  { code: 'BE', label: 'Belgique / België' },
  { code: 'CH', label: 'Schweiz / Suisse' },
  { code: 'AT', label: 'Österreich' },
  { code: 'PL', label: 'Polska' },
  { code: 'SE', label: 'Sverige' },
  { code: 'BR', label: 'Brasil' },
  { code: 'MX', label: 'México' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'JP', label: '日本' },
  { code: 'AE', label: 'United Arab Emirates' },
]

/** Thematic clusters bounds (field #13: "Enter 3-10 macro-themes"). */
export const CLUSTERS_MIN = 3
export const CLUSTERS_MAX = 10

/**
 * The four Business drivers are pre-flagged AND mandatory (Bibbia 04, STEP
 * 3): the wizard cannot disable them. Derived from the registry so the two
 * catalogs can never drift.
 */
export const MANDATORY_DRIVER_KEYS: readonly string[] = V4_BUSINESS_DRIVERS

/** The page-template drivers that share the template list (fields #16-19). */
export const TEMPLATE_DRIVER_KEYS = ['speed', 'accessibility', 'schema', 'content'] as const

/** Union the analyst's selection with the mandatory Business four. */
export function withMandatoryDrivers(keys: string[]): string[] {
  const out = [...MANDATORY_DRIVER_KEYS]
  for (const k of keys) if (!out.includes(k)) out.push(k)
  return out
}

/**
 * draft  = "save what I have": only structural problems block (bad URL,
 *          duplicate domain, out-of-range values). Missing required fields
 *          are allowed — that is what a draft IS.
 * launch = everything the Bibbia marks Required must be present.
 */
export type SetupMode = 'draft' | 'launch'

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
  /** Field #4 — Analysis country, multi. `country` stays the primary one. */
  countries?: string[]
  outputLanguage: 'it' | 'en'
  industryPreset?: IndustryPreset | null
  /** Field #6 free-text half: sector/industry beyond the preset list. */
  sector?: string | null
  siteType?: string | null
  targetAudienceMode?: TargetAudienceMode | null
  targetAudience?: string | null
  seoMaturity?: 'low' | 'medium' | 'high' | null
  drivers: string[]
  /** site_ref -> template_key -> URL. Blank/missing = template absent. */
  templates?: Record<string, Record<string, string>>
  /** driver_key -> template keys the driver measures (fields #16-19). */
  driverTemplates?: Record<string, string[]>
  /** Field #12 — J-Horizon recap pasted already in setup. */
  jhorizonAnswer?: string | null
  /** Field #13 — 3-10 macro-themes for Discoverability. */
  thematicClusters?: string[]
  /** Field #22 — words the AI must not use. */
  blocklist?: string[]
  /** Field #22 — max insights/actions cap. */
  maxInsights?: number | null
  /** Field #24 — free notes for the model. */
  additionalNotes?: string | null
  mode?: SetupMode
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
  const mode: SetupMode = input.mode ?? 'launch'

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

  if (mode === 'launch' && (!input.drivers || input.drivers.length === 0)) {
    errors.push('seleziona almeno un driver')
  }
  if (input.outputLanguage !== 'it' && input.outputLanguage !== 'en') {
    errors.push("la lingua di output deve essere 'it' o 'en'")
  }
  if (input.industryPreset && !INDUSTRY_PRESETS.includes(input.industryPreset)) {
    errors.push(`industry preset non valido: ${input.industryPreset}`)
  }

  // --- STEP 1 required fields + enum checks (Bibbia 04 fields #2-8) --------
  // Enum/format problems block even a draft (a wrong value is never worth
  // saving); MISSING values block only the launch.
  if (input.siteType && !SITE_TYPES.includes(input.siteType as SiteType)) {
    errors.push(`site type non valido: ${input.siteType}`)
  }
  if (
    input.targetAudienceMode &&
    !TARGET_AUDIENCE_MODES.includes(input.targetAudienceMode)
  ) {
    errors.push(`target audience non valido: ${input.targetAudienceMode}`)
  }
  const countries = cleanVariants(input.countries)
  if (mode === 'launch') {
    if (!input.client?.brandName?.trim()) errors.push('il brand name del cliente è obbligatorio')
    if (!input.siteType) errors.push('il site type è obbligatorio')
    if (countries.length === 0) errors.push('seleziona almeno un paese di analisi')
    // STEP 2: the Business drivers are mandatory and are all
    // competitor-relative, so a set without competitors cannot launch.
    if (competitors.length === 0) {
      errors.push('i driver Business sono obbligatori e richiedono almeno un competitor')
    }
    // Field #10b: brand name is mandatory per competitor.
    competitors.slice(0, 4).forEach((c, i) => {
      if (!c.brandName?.trim()) {
        errors.push(`brand name obbligatorio per il competitor ${i + 1} (${c.domain})`)
      }
    })
  }

  // --- STEP 3/4 optional fields with bounded values ------------------------
  const clusters = cleanVariants(input.thematicClusters)
  if (
    mode === 'launch' &&
    clusters.length > 0 &&
    (clusters.length < CLUSTERS_MIN || clusters.length > CLUSTERS_MAX)
  ) {
    errors.push(
      `i thematic cluster devono essere tra ${CLUSTERS_MIN} e ${CLUSTERS_MAX} (ricevuti ${clusters.length})`,
    )
  }
  if (clusters.length > CLUSTERS_MAX) {
    errors.push(`al massimo ${CLUSTERS_MAX} thematic cluster (ricevuti ${clusters.length})`)
  }
  if (input.maxInsights !== undefined && input.maxInsights !== null) {
    if (!Number.isInteger(input.maxInsights) || input.maxInsights <= 0) {
      errors.push(`il numero massimo di insight deve essere un intero positivo: ${input.maxInsights}`)
    }
  }
  if (input.driverTemplates) {
    for (const [driver, keys] of Object.entries(input.driverTemplates)) {
      if (!TEMPLATE_DRIVER_KEYS.includes(driver as (typeof TEMPLATE_DRIVER_KEYS)[number])) {
        errors.push(`driver senza template di pagina: ${driver}`)
        continue
      }
      for (const key of keys) {
        if (!TEMPLATE_KEYS.includes(key as TemplateKey)) {
          errors.push(`template sconosciuto per ${driver}: ${key}`)
        }
      }
    }
  }

  const templates = buildTemplates(sites, input.templates ?? {}, errors, input.driverTemplates)

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
  driverTemplates?: Record<string, string[]>,
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
        applies_to: appliesTo(key, driverTemplates),
      })
    }
  }

  return out
}

/**
 * Which page-based drivers consume a template. With no per-driver selection
 * (pre-STEP-3 setups, V1 compatibility) every page driver applies — the
 * historical behavior. With a selection, applies_to mirrors exactly the
 * checkboxes of fields #16-19, so a template flagged only for Speed is never
 * measured by Content.
 */
export function appliesTo(
  templateKey: TemplateKey,
  driverTemplates?: Record<string, string[]>,
): string[] {
  if (!driverTemplates || Object.keys(driverTemplates).length === 0) {
    return [...TEMPLATE_DRIVER_KEYS]
  }
  const drivers = TEMPLATE_DRIVER_KEYS.filter((d) =>
    (driverTemplates[d] ?? []).includes(templateKey),
  )
  // A URL nobody selected still belongs to every driver that has no explicit
  // selection at all: an empty array would silently drop the page.
  if (drivers.length === 0) {
    return TEMPLATE_DRIVER_KEYS.filter((d) => !(d in driverTemplates))
  }
  return drivers
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// V4 setup persistence (analyses.v4_setup) + downstream driver wiring
// ---------------------------------------------------------------------------

/** Upload kinds of the setup (fields #15, #20, #23). Parsing is downstream. */
export const ATTACHMENT_KINDS = ['compliance_crawl', 'authority_backlinks', 'knowledge_doc'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

/** One uploaded file, as recorded in analyses.v4_setup.attachments. */
export interface SetupAttachment {
  kind: AttachmentKind
  name: string
  /** Storage object path in the 'client-files' bucket. */
  path: string
  size: number | null
  uploaded_at: string
}

/** Which driver tab lists an upload kind ('knowledge_doc' is global). */
export const ATTACHMENT_DRIVER: Record<AttachmentKind, string | null> = {
  compliance_crawl: 'compliance',
  authority_backlinks: 'authority',
  knowledge_doc: null,
}

/**
 * The wizard state that has no dedicated analyses column, as one jsonb.
 * Attachments are NOT produced here: the files route owns that key, and the
 * caller must carry the existing list over (see mergeV4Setup).
 */
export function buildV4SetupJson(input: SetupInput): Record<string, unknown> {
  return {
    countries: cleanVariants(input.countries),
    sector: input.sector?.trim() || null,
    target_audience_mode: input.targetAudienceMode ?? null,
    thematic_clusters: cleanVariants(input.thematicClusters),
    jhorizon_answer: input.jhorizonAnswer?.trim() || null,
    additional_notes: input.additionalNotes?.trim() || null,
    enabled_drivers: [...new Set(input.drivers ?? [])],
    driver_templates: input.driverTemplates ?? {},
  }
}

/** New wizard state + attachments already uploaded on the draft. */
export function mergeV4Setup(
  existing: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const attachments = Array.isArray(existing?.attachments) ? existing.attachments : []
  // The promotion stamp (lib/v4/promote) is owned by the promote route, not
  // by the wizard: a setup save must never wipe "this audit became a client".
  const promotion: Record<string, unknown> = {}
  if (typeof existing?.promoted_client_id === 'string' && existing.promoted_client_id) {
    promotion.promoted_client_id = existing.promoted_client_id
  }
  if (typeof existing?.promoted_at === 'string' && existing.promoted_at) {
    promotion.promoted_at = existing.promoted_at
  }
  return { ...next, attachments, ...promotion }
}

export function readAttachments(
  v4Setup: Record<string, unknown> | null | undefined,
): SetupAttachment[] {
  const raw = v4Setup?.attachments
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (a): a is SetupAttachment =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as SetupAttachment).path === 'string' &&
      ATTACHMENT_KINDS.includes((a as SetupAttachment).kind),
  )
}

/**
 * Per-driver driver_runs.config seeded from the saved setup — the single
 * source the start route uses, so a draft resumed weeks later launches with
 * exactly what was configured, without trusting the browser to resend it:
 *
 *  - AI Visibility: the J-Horizon recap pasted in setup (field #12) becomes
 *    config.jhorizon_answer and the worker skips its first pause.
 *  - Discoverability: the thematic clusters (field #13) travel as
 *    config.configured_clusters into the driver's payload/evidence.
 *  - Compliance / Authority: their uploads are listed as attachments in the
 *    driver tab (parsing is a downstream TODO).
 */
export function driverConfigFromSetup(
  v4Setup: Record<string, unknown> | null | undefined,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  if (!v4Setup) return out

  const jhorizon = typeof v4Setup.jhorizon_answer === 'string' ? v4Setup.jhorizon_answer.trim() : ''
  if (jhorizon) out.ai_visibility = { jhorizon_answer: jhorizon }

  const clusters = Array.isArray(v4Setup.thematic_clusters)
    ? v4Setup.thematic_clusters.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
    : []
  if (clusters.length > 0) out.discoverability = { configured_clusters: clusters }

  for (const att of readAttachments(v4Setup)) {
    const driver = ATTACHMENT_DRIVER[att.kind]
    if (!driver) continue
    const cfg = (out[driver] ??= {})
    const list = (cfg.attachments ??= []) as unknown[]
    ;(list as SetupAttachment[]).push(att)
  }

  return out
}
