/**
 * V4 driver — Schema.
 *
 * Source: Firecrawl /scrape (single source, no fallback) + the internal markup
 * KB in ./schema-kb. Pages are scraped, JSON-LD is extracted with the existing
 * structured-data parser, each markup type the industry preset expects is
 * graded on the 0 / 0.25 / 0.50 / 0.75 / 1.00 rubric, and the three clusters
 * are combined at the constant 50 / 35 / 15 weights.
 *
 * Read the provenance warning at the top of ./schema-kb before trusting the
 * numbers: the property lists and the preset->cluster mapping are derived from
 * Google/schema.org documentation, not transcribed from sheet 6.
 *
 * Two failure modes matter here and are the reason this driver exists at all:
 *   - a page that cannot be scraped is a FAILURE, never a 0. V1 wrote a
 *     detection failure to the DB as a real measurement and Ariston scored
 *     0/100 on Schema for a site that had markup.
 *   - a site whose pages all fail is left out of the result entirely, so it is
 *     excluded from the normalization rather than dragging the set down.
 *
 * `formats: ['rawHtml']` is not optional: Firecrawl's cleaned `html` strips
 * <head>, and with it every JSON-LD block on most sites (the bug fixed in
 * 96be214). Grading a stripped page would report "markup absent" for a site
 * that is fully marked up.
 */

import { scrapeWithFirecrawl } from '@/lib/integrations/providers/firecrawl/client'
import { parseJsonLdBlocks } from '@/lib/integrations/providers/structured-data/parser'
import type { AnalysisSite, DriverJobContext, DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { urlsForSite } from './pagespeed'
import { DriverSourceError, assertDeadline, mapPool, round } from './source'
import {
  MARKUP_KB,
  MARKUP_TYPES,
  SITEWIDE_THRESHOLD,
  computeSchemaScore,
  resolveClusters,
  scoreMarkupType,
  type ClusterMap,
  type MarkupObservation,
  type MarkupType,
  type MarkupTypeScore,
} from './schema-kb'

/** One JSON-LD node: the types it declares and the property names it carries. */
export interface JsonLdNode {
  types: string[]
  properties: string[]
}

/**
 * Flatten a parsed JSON-LD payload into nodes.
 *
 * Mirrors the traversal of the structured-data parser (root, arrays, @graph)
 * on purpose: if this walked deeper it would count nested sub-objects — an
 * `offers` node inside a Product, a `publisher` Organization inside an
 * Article — as sitewide markup in their own right, and Organization would come
 * out "present on every page" on any site with an Article template.
 */
export function collectJsonLdNodes(data: unknown): JsonLdNode[] {
  const out: JsonLdNode[] = []

  const visit = (node: unknown): void => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (typeof node !== 'object') return
    const obj = node as Record<string, unknown>

    const t = obj['@type']
    const types = typeof t === 'string' ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : []
    if (types.length > 0) {
      out.push({
        types,
        // @context is boilerplate and never a graded property; every other
        // key (including @id, which the KB grades as advanced) counts.
        properties: Object.keys(obj).filter((k) => k !== '@context' && obj[k] != null),
      })
    }

    const graph = obj['@graph']
    if (Array.isArray(graph)) for (const g of graph) visit(g)
  }

  visit(data)
  return out
}

export interface PageScrape {
  url: string
  nodes: JsonLdNode[]
  /** JSON-LD blocks on the page that failed to parse — a 1.00 blocker. */
  parseErrors: number
  blockCount: number
}

/** Scrape one page and reduce it to its JSON-LD nodes. Throws on any failure. */
export async function scrapePage(url: string): Promise<PageScrape> {
  const res = await scrapeWithFirecrawl(url, { formats: ['rawHtml'] })
  if (!res.ok || !res.html) {
    // The real reason travels with the error: "no_credentials" and "HTTP 403"
    // demand completely different fixes, and a 0 would hide both.
    throw new DriverSourceError(
      `Schema: Firecrawl could not scrape ${url} (${res.status}${res.detail ? `: ${res.detail}` : ''})`,
    )
  }

  const blocks = parseJsonLdBlocks(res.html)
  const nodes = blocks.filter((b) => b.parsed).flatMap((b) => collectJsonLdNodes(b.data))
  return {
    url,
    nodes,
    parseErrors: blocks.filter((b) => !b.parsed).length,
    blockCount: blocks.length,
  }
}

/**
 * Turn the scraped pages of one site into one observation per markup type.
 *
 * Coverage is measured against the pages ACTUALLY scraped, never against the
 * site: with the setup wizard still unbuilt that is often a single page, and
 * "1/1 pages" must not be reported as sitewide certainty. The denominator
 * travels into the evidence for exactly that reason.
 */
export function observeSite(pages: PageScrape[], type: MarkupType): MarkupObservation {
  const spec = MARKUP_KB[type]
  const nodes: MarkupObservation['nodes'] = []
  let pagesWithType = 0
  let valid = true

  for (const page of pages) {
    const own = page.nodes.filter((n) => n.types.includes(type))
    if (own.length === 0) continue
    pagesWithType += 1
    if (page.parseErrors > 0) valid = false
    for (const n of own) nodes.push({ url: page.url, properties: n.properties })
  }

  // The only incoherence we can honestly detect without rendering the page and
  // comparing it to the markup: a node that declares the type and then says
  // nothing about it. Anything subtler (a Product block on a category page,
  // a FAQPage whose questions are not on the page) needs content comparison
  // this driver does not do, so a `true` here means "not obviously a shell",
  // not "verified coherent" — and the evidence says so.
  const coherent =
    nodes.length > 0 && nodes.some((n) => spec.mandatory.some((p) => n.properties.includes(p)))

  return { nodes, pagesScraped: pages.length, pagesWithType, coherent, valid }
}

export interface SiteSchemaResult {
  site: AnalysisSite
  pages: PageScrape[]
  errors: string[]
}

/** Scrape every page of one site, keeping the pages that worked. */
async function measureSite(ctx: DriverJobContext, site: AnalysisSite): Promise<SiteSchemaResult> {
  const urls = urlsForSite(ctx, site)
  const errors: string[] = []

  const pages = await mapPool(urls, 3, async (url): Promise<PageScrape | null> => {
    try {
      assertDeadline(ctx.deadlineAt, `Schema for ${url}`)
      return await scrapePage(url)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
      return null
    }
  })

  return { site, pages: pages.filter((p): p is PageScrape => p !== null), errors }
}

export const schemaWorker: DriverWorker = async (ctx) => {
  const errors: string[] = []
  const resolved = resolveClusters(ctx.config.industry_preset)
  const clusters: ClusterMap = resolved.clusters

  // 2 sites in flight: each one fans out to its own page pool, and Firecrawl
  // bills and rate-limits per scrape.
  const results = await mapPool(ctx.sites, 2, (site) => measureSite(ctx, site))

  const measured: SiteRawValue[] = []
  for (const result of results) {
    errors.push(...result.errors)
    // Every page failed: nothing was observed, so nothing can be scored. The
    // site is left out and excluded from the normalization (sheet 8).
    if (result.pages.length === 0) continue

    const scores = new Map<MarkupType, MarkupTypeScore>()
    const scoreOf = (type: MarkupType): MarkupTypeScore => {
      const cached = scores.get(type)
      if (cached) return cached
      const s = scoreMarkupType(type, observeSite(result.pages, type))
      scores.set(type, s)
      return s
    }

    const computed = computeSchemaScore(clusters, scoreOf)
    const typesFound = Array.from(
      new Set(result.pages.flatMap((p) => p.nodes.flatMap((n) => n.types))),
    ).sort()

    measured.push({
      site_ref: result.site.site_ref,
      domain: result.site.domain,
      raw: round(computed.score, 1),
      score_absolute: Math.round(computed.score),
      evidence: {
        pages_scraped: result.pages.map((p) => ({
          url: p.url,
          jsonld_blocks: p.blockCount,
          parse_errors: p.parseErrors,
        })),
        pages_failed: result.errors,
        // What the site actually declares, including types outside the KB —
        // useful when a preset looks mis-assigned.
        types_found: typesFound,
        types_found_outside_kb: typesFound.filter(
          (t) => !(MARKUP_TYPES as readonly string[]).includes(t),
        ),
        clusters: computed.clusters.map((c) => ({
          cluster: c.cluster,
          weight: c.weight,
          mean: c.mean === null ? null : round(c.mean, 4),
          types: c.types.map((t) => ({
            type: t.type,
            level: t.level,
            reason: t.reason,
            missing_mandatory: t.missingMandatory,
            missing_recommended: t.missingRecommended,
            missing_advanced: t.missingAdvanced,
            pages_with_type: t.pagesWithType,
            pages_scraped: t.pagesScraped,
            coverage_pct: t.coverage === null ? null : round(t.coverage * 100, 1),
            nodes: t.nodeCount,
            valid_jsonld: t.valid,
          })),
        })),
        weights_renormalized: computed.weightsRenormalized,
        coverage_basis: `sitewide coverage judged on the ${result.pages.length} page(s) actually scraped, threshold ${SITEWIDE_THRESHOLD * 100}%`,
        coherence_check: 'shell-node detection only; markup was not compared against rendered page content',
      },
    })
  }

  const clientRef = ctx.sites.find((s) => s.is_client)?.site_ref
  if (!measured.some((s) => s.site_ref === clientRef)) {
    return {
      status: 'error',
      error: `Schema could not be measured for the client site. ${errors.join(' | ') || 'no reason reported'}`,
      rawPayload: { errors, industry_preset: resolved.preset, preset_source: resolved.source },
    }
  }

  return {
    status: 'done',
    sites: measured,
    rawPayload: {
      source: 'firecrawl:v1/scrape + internal markup KB',
      industry_preset: resolved.preset,
      // Loud on purpose: a neutral run is NOT an industry-tuned score.
      preset_source: resolved.source,
      preset_note:
        resolved.source === 'preset'
          ? 'Cluster membership taken from the analysis industry preset.'
          : 'No valid industry_preset on this analysis: a neutral, sector-agnostic cluster map was used. ' +
            'The score is not industry-calibrated and must not be presented as such.',
      clusters,
      cluster_weights: { core: 0.5, content_local: 0.35, supporting: 0.15 },
      kb_provenance:
        'Property lists and preset->cluster mapping derived from Google structured-data docs and ' +
        'schema.org, NOT transcribed from sheet 6 of the Drivers Bibbia. Pending verification.',
      scope: ctx.templates.some((t) => t.url)
        ? 'configured page templates'
        : 'homepage only (no page templates configured yet)',
      unmeasured: ctx.sites
        .filter((s) => !measured.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      errors,
    },
  }
}
