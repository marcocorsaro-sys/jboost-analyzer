/**
 * V4 Schema driver — markup knowledge base and the pure rubric math.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE WARNING — READ BEFORE TRUSTING ANY SCHEMA SCORE
 * ---------------------------------------------------------------------------
 * The authoritative source for this knowledge base is "foglio 6" of the
 * Drivers Bibbia. That sheet is NOT in this repository: the only trace of it
 * here is the one-line summary in
 * docs/driver-intelligence-platform-v3-handoff.md, which names the 14 markup
 * types and says each one has a mandatory / recommended / advanced property
 * list — but does not contain the lists themselves.
 *
 * The property lists below were therefore DERIVED from Google's
 * structured-data documentation (developers.google.com/search/docs/appearance/
 * structured-data) and from schema.org type definitions. They are NOT a
 * transcription of sheet 6, and nobody has reconciled the two yet.
 *
 * Same for the preset -> cluster mapping: the handoff doc states only that the
 * three cluster WEIGHTS are constant (50 / 35 / 15) and that what varies per
 * industry is which markup type sits in which cluster. WHICH type goes WHERE
 * is not written down anywhere in this repo, so PRESET_CLUSTERS below is a
 * reasoned proposal, not the spec.
 *
 * Consequence: the driver mechanics (scraping, parsing, rubric, weighting) can
 * be trusted, the absolute numbers cannot, until this file has been checked
 * line by line against sheet 6. Do not ship a client-facing Schema score
 * before that verification happens.
 * ---------------------------------------------------------------------------
 *
 * Everything in this file is pure: no I/O, no clock, no network. The worker in
 * ./schema.ts supplies the observations; this module only judges them.
 */

import { INDUSTRY_PRESETS, type IndustryPreset } from '@/lib/v4/setup'

/** The 14 markup types of the KB (handoff doc, "Schema scoring"). */
export const MARKUP_TYPES = [
  'Product',
  'BreadcrumbList',
  'Organization',
  'FAQPage',
  'Article',
  'NewsArticle',
  'LocalBusiness',
  'VideoObject',
  'ItemList',
  'Service',
  'FinancialProduct',
  'TouristTrip',
  'AboutPage',
  'ContactPage',
] as const
export type MarkupType = (typeof MARKUP_TYPES)[number]

export interface MarkupSpec {
  /** Missing any of these caps the type at 0.25. */
  mandatory: string[]
  /** All mandatory present but any of these missing caps the type at 0.50. */
  recommended: string[]
  /** Missing any of these caps the type at 0.75. */
  advanced: string[]
}

/**
 * Property lists per markup type. See the provenance warning above.
 *
 * Convention: `@id` counts as an ADVANCED property throughout. Explicit node
 * identifiers are what turns a pile of separate JSON-LD blocks into a linked
 * entity graph, which is exactly the kind of thing the 0.75 -> 1.00 step is
 * meant to reward, and it is the one JSON-LD keyword that is a real editorial
 * decision rather than boilerplate.
 */
export const MARKUP_KB: Record<MarkupType, MarkupSpec> = {
  Product: {
    mandatory: ['name', 'image', 'offers'],
    recommended: ['description', 'sku', 'brand', 'aggregateRating', 'review'],
    advanced: ['gtin', 'mpn', 'hasMerchantReturnPolicy', 'shippingDetails', 'isVariantOf', '@id'],
  },
  BreadcrumbList: {
    mandatory: ['itemListElement'],
    recommended: ['name', 'numberOfItems'],
    advanced: ['@id'],
  },
  Organization: {
    mandatory: ['name', 'url'],
    recommended: ['logo', 'sameAs', 'description'],
    advanced: ['contactPoint', 'address', 'identifier', 'foundingDate', '@id'],
  },
  FAQPage: {
    mandatory: ['mainEntity'],
    recommended: ['name', 'url'],
    advanced: ['inLanguage', 'isPartOf', '@id'],
  },
  Article: {
    mandatory: ['headline', 'image', 'datePublished'],
    recommended: ['author', 'dateModified', 'publisher', 'description'],
    advanced: ['mainEntityOfPage', 'articleSection', 'keywords', 'speakable', '@id'],
  },
  NewsArticle: {
    mandatory: ['headline', 'image', 'datePublished'],
    recommended: ['author', 'dateModified', 'publisher', 'description'],
    advanced: ['mainEntityOfPage', 'articleSection', 'dateline', 'isAccessibleForFree', '@id'],
  },
  LocalBusiness: {
    mandatory: ['name', 'address'],
    recommended: ['telephone', 'openingHoursSpecification', 'geo', 'url', 'image'],
    advanced: ['priceRange', 'sameAs', 'areaServed', 'hasMap', 'aggregateRating', '@id'],
  },
  VideoObject: {
    mandatory: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
    recommended: ['duration', 'contentUrl', 'embedUrl'],
    advanced: ['hasPart', 'regionsAllowed', 'interactionStatistic', 'transcript', '@id'],
  },
  ItemList: {
    mandatory: ['itemListElement'],
    recommended: ['name', 'numberOfItems'],
    advanced: ['itemListOrder', 'url', '@id'],
  },
  Service: {
    mandatory: ['name', 'provider'],
    recommended: ['description', 'areaServed', 'serviceType'],
    advanced: ['offers', 'hasOfferCatalog', 'audience', 'termsOfService', '@id'],
  },
  FinancialProduct: {
    mandatory: ['name', 'provider'],
    recommended: ['description', 'feesAndCommissionsSpecification', 'interestRate', 'url'],
    advanced: ['annualPercentageRate', 'termsOfService', 'areaServed', 'audience', '@id'],
  },
  TouristTrip: {
    mandatory: ['name', 'itinerary'],
    recommended: ['description', 'provider', 'touristType', 'offers'],
    advanced: ['arrivalTime', 'departureTime', 'subjectOf', 'aggregateRating', '@id'],
  },
  AboutPage: {
    mandatory: ['name'],
    recommended: ['url', 'description', 'mainEntity'],
    advanced: ['breadcrumb', 'isPartOf', 'inLanguage', '@id'],
  },
  ContactPage: {
    mandatory: ['name'],
    recommended: ['url', 'description', 'mainEntity'],
    advanced: ['breadcrumb', 'isPartOf', 'significantLink', '@id'],
  },
}

export type ClusterKey = 'core' | 'content_local' | 'supporting'

/**
 * Constant across every industry (handoff doc, "Industry preset"): only the
 * membership of the clusters is industry-specific, never the weights.
 */
export const CLUSTER_WEIGHTS: Record<ClusterKey, number> = {
  core: 0.5,
  content_local: 0.35,
  supporting: 0.15,
}

export type ClusterMap = Record<ClusterKey, MarkupType[]>

/**
 * Which markup types each industry expects in each cluster. See the provenance
 * warning: this is a reasoned proposal, not sheet 6.
 *
 * The reasoning applied uniformly: `core` holds the types that carry the
 * industry's primary commercial entity plus the two types every site needs to
 * be machine-readable at all (Organization, BreadcrumbList); `content_local`
 * holds the types that describe editorial or physical presence; `supporting`
 * holds the corporate-trust and media types that add value but whose absence
 * is not a structural failure.
 */
export const PRESET_CLUSTERS: Record<IndustryPreset, ClusterMap> = {
  retail_luxury: {
    core: ['Product', 'Organization', 'BreadcrumbList'],
    content_local: ['ItemList', 'FAQPage', 'LocalBusiness'],
    supporting: ['VideoObject', 'AboutPage', 'ContactPage'],
  },
  banking_finance: {
    core: ['FinancialProduct', 'Organization', 'BreadcrumbList'],
    content_local: ['Service', 'FAQPage', 'LocalBusiness'],
    supporting: ['Article', 'AboutPage', 'ContactPage'],
  },
  media_publishing: {
    core: ['NewsArticle', 'Article', 'Organization'],
    content_local: ['BreadcrumbList', 'ItemList', 'FAQPage'],
    supporting: ['VideoObject', 'AboutPage', 'ContactPage'],
  },
  travel_hospitality: {
    core: ['TouristTrip', 'Organization', 'BreadcrumbList'],
    content_local: ['LocalBusiness', 'FAQPage', 'ItemList'],
    supporting: ['Article', 'VideoObject', 'ContactPage'],
  },
  b2b_services: {
    core: ['Service', 'Organization', 'BreadcrumbList'],
    content_local: ['Article', 'FAQPage', 'ItemList'],
    supporting: ['VideoObject', 'AboutPage', 'ContactPage'],
  },
  pharma_healthcare: {
    core: ['Organization', 'Article', 'BreadcrumbList'],
    content_local: ['FAQPage', 'LocalBusiness', 'Service'],
    supporting: ['VideoObject', 'AboutPage', 'ContactPage'],
  },
  home_appliances: {
    core: ['Product', 'Organization', 'BreadcrumbList'],
    content_local: ['FAQPage', 'ItemList', 'Article'],
    supporting: ['VideoObject', 'Service', 'ContactPage'],
  },
}

/**
 * Used when the analysis has no industry_preset.
 *
 * Deliberately NOT one of the seven presets: silently picking, say,
 * retail_luxury would make an untuned score look tuned. It contains only the
 * types every site is expected to have regardless of sector, and its use is
 * flagged in the driver evidence (`preset_source: 'neutral_fallback'`) so the
 * number is never mistaken for an industry-calibrated one.
 */
export const NEUTRAL_CLUSTERS: ClusterMap = {
  core: ['Organization', 'BreadcrumbList'],
  content_local: ['Article', 'FAQPage'],
  supporting: ['AboutPage', 'ContactPage'],
}

export interface ResolvedClusters {
  preset: IndustryPreset | null
  clusters: ClusterMap
  /** 'preset' | 'neutral_fallback' | 'unknown_preset_fallback' — goes in the evidence. */
  source: 'preset' | 'neutral_fallback' | 'unknown_preset_fallback'
}

/** Resolve `industry_preset` (whatever the config holds) into a cluster map. */
export function resolveClusters(raw: unknown): ResolvedClusters {
  if (raw == null || raw === '') {
    return { preset: null, clusters: NEUTRAL_CLUSTERS, source: 'neutral_fallback' }
  }
  const value = String(raw)
  if ((INDUSTRY_PRESETS as readonly string[]).includes(value)) {
    const preset = value as IndustryPreset
    return { preset, clusters: PRESET_CLUSTERS[preset], source: 'preset' }
  }
  // A preset the DB CHECK should have rejected. Still no silent default: the
  // neutral map is used and the anomaly is reported.
  return { preset: null, clusters: NEUTRAL_CLUSTERS, source: 'unknown_preset_fallback' }
}

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

export type RubricLevel = 0 | 0.25 | 0.5 | 0.75 | 1

/** The share of a site's scraped pages that must carry a type to call it sitewide. */
export const SITEWIDE_THRESHOLD = 0.95

/** One markup type as actually observed on one site. */
export interface MarkupObservation {
  /**
   * Every JSON-LD node of this type found across the scraped pages, with the
   * property names it declares. Empty = the type is absent from the site.
   */
  nodes: Array<{ url: string; properties: string[] }>
  /** Pages of this site that were scraped successfully — the coverage denominator. */
  pagesScraped: number
  /** Pages carrying at least one node of this type — the coverage numerator. */
  pagesWithType: number
  /**
   * False when the markup is present but does not describe the page it sits
   * on. The worker can only detect the crude case (an empty shell node), so a
   * true positive here is meaningful and a true negative is not proof of
   * coherence — hence `coherenceCheck` in the result.
   */
  coherent: boolean
  /** False when a JSON-LD block on a page carrying this type failed to parse. */
  valid: boolean
}

export interface MarkupTypeScore {
  type: MarkupType
  level: RubricLevel
  /** Plain-language justification, carried into the driver panel evidence. */
  reason: string
  missingMandatory: string[]
  missingRecommended: string[]
  missingAdvanced: string[]
  /** Share of scraped pages carrying the type, 0..1. null when nothing was scraped. */
  coverage: number | null
  pagesScraped: number
  pagesWithType: number
  nodeCount: number
  valid: boolean
}

/**
 * A property counts as present only when EVERY observed node of the type
 * declares it.
 *
 * The alternative (union across nodes) would let one well-marked-up product
 * page vouch for a thousand incomplete ones, which is the opposite of what a
 * comparative audit is for.
 */
function missingProps(nodes: MarkupObservation['nodes'], required: string[]): string[] {
  return required.filter((prop) => !nodes.every((n) => n.properties.includes(prop)))
}

/**
 * The 5-point rubric of the spec:
 *   0.00 absent, or present but not coherent with the page
 *   0.25 present, a mandatory property missing
 *   0.50 mandatory complete, recommended missing
 *   0.75 mandatory + recommended complete, advanced missing OR not sitewide
 *   1.00 complete + sitewide coverage >= 95% + valid
 */
export function scoreMarkupType(type: MarkupType, obs: MarkupObservation): MarkupTypeScore {
  const spec = MARKUP_KB[type]
  const coverage = obs.pagesScraped > 0 ? obs.pagesWithType / obs.pagesScraped : null
  const base = {
    type,
    coverage,
    pagesScraped: obs.pagesScraped,
    pagesWithType: obs.pagesWithType,
    nodeCount: obs.nodes.length,
    valid: obs.valid,
  }

  if (obs.nodes.length === 0) {
    return {
      ...base,
      level: 0,
      reason: `${type} markup is absent from the ${obs.pagesScraped} page(s) scraped`,
      missingMandatory: spec.mandatory,
      missingRecommended: spec.recommended,
      missingAdvanced: spec.advanced,
    }
  }

  const missingMandatory = missingProps(obs.nodes, spec.mandatory)
  const missingRecommended = missingProps(obs.nodes, spec.recommended)
  const missingAdvanced = missingProps(obs.nodes, spec.advanced)
  const rest = { ...base, missingMandatory, missingRecommended, missingAdvanced }

  if (!obs.coherent) {
    return {
      ...rest,
      level: 0,
      reason: `${type} markup is present but does not describe the page content (empty or placeholder node)`,
    }
  }

  if (missingMandatory.length > 0) {
    return {
      ...rest,
      level: 0.25,
      reason: `${type}: mandatory propert${missingMandatory.length === 1 ? 'y' : 'ies'} missing on at least one node (${missingMandatory.join(', ')})`,
    }
  }

  if (missingRecommended.length > 0) {
    return {
      ...rest,
      level: 0.5,
      reason: `${type}: all mandatory properties present, recommended missing (${missingRecommended.join(', ')})`,
    }
  }

  const sitewide = coverage !== null && coverage >= SITEWIDE_THRESHOLD
  if (missingAdvanced.length > 0 || !sitewide || !obs.valid) {
    const why: string[] = []
    if (missingAdvanced.length > 0) why.push(`advanced missing (${missingAdvanced.join(', ')})`)
    if (!sitewide) {
      why.push(
        `coverage ${obs.pagesWithType}/${obs.pagesScraped} page(s) is below the 95% sitewide threshold`,
      )
    }
    // Invalid JSON-LD alongside the type is a 1.00 blocker, not a 0: the
    // markup is there and complete, one block on the page is broken.
    if (!obs.valid) why.push('a JSON-LD block on a page carrying this type failed to parse')
    return { ...rest, level: 0.75, reason: `${type}: ${why.join('; ')}` }
  }

  return {
    ...rest,
    level: 1,
    reason: `${type}: complete, valid and present on ${obs.pagesWithType}/${obs.pagesScraped} scraped page(s)`,
  }
}

// ---------------------------------------------------------------------------
// Cluster math
// ---------------------------------------------------------------------------

export interface ClusterResult {
  cluster: ClusterKey
  /** The weight actually applied — normally CLUSTER_WEIGHTS, see below. */
  weight: number
  mean: number | null
  types: MarkupTypeScore[]
}

export interface SchemaScoreResult {
  /** 0..100, the driver raw. */
  score: number
  clusters: ClusterResult[]
  /** True when a cluster was empty and the remaining weights were renormalized. */
  weightsRenormalized: boolean
}

/**
 * `(mean(core)*0.50 + mean(content_local)*0.35 + mean(supporting)*0.15) * 100`.
 *
 * A type the preset expects but the site does not have scores 0 and stays in
 * the mean — that absence is precisely what the driver is measuring, so it
 * must not be excluded the way an unmeasurable SITE is.
 *
 * A cluster left empty by the mapping has no mean; rather than treat it as 0
 * (which would invent a failure) the remaining weights are renormalized and
 * the fact is reported. None of the seven presets does this today.
 */
export function computeSchemaScore(
  clusters: ClusterMap,
  scoreOf: (type: MarkupType) => MarkupTypeScore,
): SchemaScoreResult {
  const results: ClusterResult[] = (Object.keys(CLUSTER_WEIGHTS) as ClusterKey[]).map((key) => {
    const types = clusters[key].map(scoreOf)
    const m =
      types.length === 0
        ? null
        : types.reduce((sum, t) => sum + t.level, 0) / types.length
    return { cluster: key, weight: CLUSTER_WEIGHTS[key], mean: m, types }
  })

  const active = results.filter((r) => r.mean !== null)
  const totalWeight = active.reduce((sum, r) => sum + r.weight, 0)
  const renormalized = totalWeight > 0 && Math.abs(totalWeight - 1) > 1e-9

  for (const r of results) {
    if (r.mean !== null && renormalized) r.weight = r.weight / totalWeight
  }

  const score = active.reduce((sum, r) => sum + (r.mean as number) * r.weight, 0) * 100

  return { score, clusters: results, weightsRenormalized: renormalized }
}
