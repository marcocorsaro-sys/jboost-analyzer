/**
 * Schema Radiography — end-to-end pipeline.
 *
 * Orchestrates URL discovery, Firecrawl scraping, JSON-LD + OG extraction,
 * deterministic scoring, and LLM-drafted enrichment. Emits the JSONB payload
 * that lives on `client_schema_reports.report`.
 */

import { scrapeWithFirecrawl, type FirecrawlScrapeResult } from '@/lib/integrations/providers/firecrawl/client'
import { discoverUrls, type DiscoveredUrl, DEFAULT_SAMPLE_SIZE } from './discover'
import {
  extractSchemaBlocks,
  extractOpenGraph,
  type SchemaBlock,
  type OpenGraphTags,
} from './extract'
import {
  scoreBlock,
  projectScore,
  projectNewBlock,
  overallScore,
  type BlockScore,
} from './score'
import { draftEnrichment, type EnrichmentProposal } from './enrich'
import {
  RUBRICS,
  resolveType,
  PAGE_ROLE_LABEL,
  type PageRole,
} from './rubrics'

const SCRAPE_CONCURRENCY = 6
const SCRAPE_WAIT_MS = 6_000

export interface TemplateReport {
  /** Resolved rubric type ("Product", "Article", ...). */
  type: string
  /** Italian label for the UI ("JSON di prodotto"). */
  label: string
  /** Page role this template plays on the site. */
  pageRole: PageRole
  pageRoleLabel: string
  /** Number of pages where a block of this type appears. */
  occurrences: number
  /** Total pages crawled (denominator for "su X/Y pagine"). */
  pagesCrawled: number
  /** Current average score across all detected occurrences. */
  score: number
  /** Projected score if the enrichment proposal is fully applied. */
  projectedScore: number
  projectedDelta: number
  /** Properties present in at least one occurrence (deduplicated). */
  presentProperties: string[]
  /** Required-tier properties missing in the sample block. */
  missingRequired: { key: string; why: string }[]
  /** Google-recommended properties missing. */
  missingRecommendedGoogle: { key: string; why: string }[]
  /** Schema.org recommended properties missing. */
  missingRecommendedSchema: { key: string; why: string }[]
  /** Representative URL (first page where the block was found). */
  sampleUrl: string
  /** Raw JSON-LD from the sample page (for transparency in the UI). */
  sampleRaw: Record<string, unknown>
  /** LLM-drafted enrichment for this template. */
  enrichment: EnrichmentProposal | null
}

export interface PageRoleSummary {
  role: PageRole
  label: string
  pages: number
  templatesCovered: number
}

export interface SchemaRadiographyReport {
  version: 1
  generatedAt: string
  /** Pages we actually scraped (some discovery URLs may fail). */
  pagesAnalyzed: { url: string; role: PageRole; jsonLdBlocks: number; openGraphTags: number; htmlSize: number; status: 'ok' | 'failed'; error?: string }[]
  /** Total JSON-LD blocks detected across all pages. */
  totalBlocks: number
  /** Per-template aggregates with score + projected score + enrichment. */
  templates: TemplateReport[]
  /** OpenGraph summary (averaged across pages). */
  openGraph: {
    averageTags: number
    pagesWithFullOg: number
    missingByTag: Record<string, number>
  }
  /** Big-number top scores. */
  overall: {
    currentScore: number
    projectedScore: number
    delta: number
  }
  pageRoleSummary: PageRoleSummary[]
  /** Templates the site is COMPLETELY missing but has the page roles for. */
  opportunities: { rubricType: string; label: string; rationale: string; projectedScore: number; pagesEligible: number }[]
  /** LLM cost tally. */
  usage: {
    enrichmentCalls: number
    inputTokens: number
    outputTokens: number
  }
  discovery: {
    source: 'sitemap' | 'homepage_only'
    sitemapSize: number
    requested: number
    actuallyScraped: number
  }
}

export interface RadiographyOptions {
  domain: string
  /** Defaults to 30. Capped to avoid runaway Firecrawl bills. */
  sampleSize?: number
  /** Skip the LLM enrichment phase (useful for low-cost re-runs). */
  skipEnrichment?: boolean
}

const MAX_SAMPLE_SIZE = 60

function normalizeDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase()
}

/** Strict same-site URL builder for the homepage. */
function homepageUrl(domain: string): string {
  return `https://${normalizeDomain(domain)}/`
}

/** Run N async tasks with a fixed-concurrency worker pool. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

interface PageScrapeResult {
  url: string
  role: PageRole
  scrape: FirecrawlScrapeResult
  blocks: SchemaBlock[]
  openGraph: OpenGraphTags
}

async function scrapeAndExtract(target: DiscoveredUrl): Promise<PageScrapeResult> {
  const scrape = await scrapeWithFirecrawl(target.url, {
    formats: ['html', 'markdown'],
    waitFor: SCRAPE_WAIT_MS,
  })
  if (!scrape.ok || !scrape.html) {
    return {
      url: target.url,
      role: target.role,
      scrape,
      blocks: [],
      openGraph: { pageUrl: target.url, tags: {} },
    }
  }
  const blocks = extractSchemaBlocks(scrape.html, target.url)
  const openGraph = extractOpenGraph(scrape.html, target.url)
  return { url: target.url, role: target.role, scrape, blocks, openGraph }
}

/**
 * Group detected blocks by (resolved type, page role) so each "template" is
 * one row in the report. Blocks with no rubric are dropped from grouping
 * (still counted in totalBlocks though).
 */
function groupBlocks(pages: PageScrapeResult[]): Map<string, { type: string; pageRole: PageRole; blocks: { block: SchemaBlock; pageRole: PageRole }[] }> {
  const groups = new Map<string, { type: string; pageRole: PageRole; blocks: { block: SchemaBlock; pageRole: PageRole }[] }>()
  for (const page of pages) {
    for (const block of page.blocks) {
      const t = resolveType(block.type)
      if (!t) continue
      // Pin BreadcrumbList to its sitewide role regardless of the page —
      // breadcrumbs are a cross-cutting template, not page-specific.
      const role: PageRole = t === 'BreadcrumbList' ? 'breadcrumb' : page.role
      const key = `${t}::${role}`
      const existing = groups.get(key) ?? { type: t, pageRole: role, blocks: [] }
      existing.blocks.push({ block, pageRole: role })
      groups.set(key, existing)
    }
  }
  return groups
}

/**
 * Detect "opportunities": rubric types that are completely absent on the
 * site, but where the crawl saw pages with the matching role. E.g. site has
 * `/faq` pages but no FAQPage JSON-LD at all → opportunity worth surfacing.
 */
function detectOpportunities(
  pages: PageScrapeResult[],
  existingKeys: Set<string>,
): SchemaRadiographyReport['opportunities'] {
  const rolesPresent = new Map<PageRole, number>()
  for (const p of pages) {
    rolesPresent.set(p.role, (rolesPresent.get(p.role) ?? 0) + 1)
  }
  const out: SchemaRadiographyReport['opportunities'] = []
  for (const rubric of Object.values(RUBRICS)) {
    for (const role of rubric.pageRoles) {
      const pagesWithRole = rolesPresent.get(role) ?? 0
      if (pagesWithRole === 0) continue
      const key = `${rubric.type}::${role}`
      if (existingKeys.has(key)) continue
      const projected = projectNewBlock(rubric.type, rubric.properties.map(p => p.key)).score
      out.push({
        rubricType: rubric.type,
        label: rubric.italianLabel,
        rationale: `${pagesWithRole} pagina/e con ruolo "${PAGE_ROLE_LABEL[role]}" senza ${rubric.italianLabel}.`,
        projectedScore: projected,
        pagesEligible: pagesWithRole,
      })
      break // one opportunity per rubric type max
    }
  }
  // Deduplicate by rubric type + sort by pagesEligible desc.
  const seen = new Set<string>()
  return out
    .filter(o => (seen.has(o.rubricType) ? false : (seen.add(o.rubricType), true)))
    .sort((a, b) => b.pagesEligible - a.pagesEligible)
    .slice(0, 8)
}

/**
 * Run the full radiography pipeline. Returns a JSONB-ready report ready to
 * persist on `client_schema_reports`.
 */
export async function runRadiography(opts: RadiographyOptions): Promise<SchemaRadiographyReport> {
  const home = homepageUrl(opts.domain)
  const sampleSize = Math.min(opts.sampleSize ?? DEFAULT_SAMPLE_SIZE, MAX_SAMPLE_SIZE)

  // 1. Discovery
  const discovery = await discoverUrls(home, sampleSize)
  const urls = discovery.urls

  // 2. Scrape + extract (concurrent)
  const pages = await runWithConcurrency(urls, SCRAPE_CONCURRENCY, scrapeAndExtract)
  const pagesAnalyzed: SchemaRadiographyReport['pagesAnalyzed'] = pages.map(p => ({
    url: p.url,
    role: p.role,
    jsonLdBlocks: p.blocks.length,
    openGraphTags: Object.keys(p.openGraph.tags).length,
    htmlSize: p.scrape.html?.length ?? 0,
    status: p.scrape.ok ? 'ok' : 'failed',
    error: p.scrape.ok ? undefined : `${p.scrape.status}${p.scrape.detail ? ' — ' + p.scrape.detail : ''}`,
  }))

  const totalBlocks = pages.reduce((acc, p) => acc + p.blocks.length, 0)

  // 3. Group by template
  const groups = groupBlocks(pages)

  // 4. Score every block, aggregate per template
  const templateReports: TemplateReport[] = []
  let enrichmentCalls = 0
  let inputTokens = 0
  let outputTokens = 0

  for (const group of groups.values()) {
    const scores: BlockScore[] = group.blocks.map(({ block }) => scoreBlock(block))
    const validScores = scores.filter(s => s.rubricType !== null)
    if (validScores.length === 0) continue

    // Sample block = the one with the most properties present (best
    // representative for the LLM to extend rather than build from scratch).
    let sampleIdx = 0
    for (let i = 1; i < group.blocks.length; i++) {
      if (validScores[i].present.length > validScores[sampleIdx].present.length) sampleIdx = i
    }
    const sample = group.blocks[sampleIdx].block
    const sampleScore = validScores[sampleIdx]

    // Union of present properties across all occurrences.
    const allPresent = new Set<string>()
    for (const s of validScores) for (const k of s.present) allPresent.add(k)

    const missing = [
      ...sampleScore.missingRequired,
      ...sampleScore.missingRecommendedGoogle,
      ...sampleScore.missingRecommendedSchema,
    ]
    const proposedKeys = missing.map(m => m.key)

    // 5. LLM enrichment (one call per template). Skipped if opts.skipEnrichment.
    let enrichment: EnrichmentProposal | null = null
    if (!opts.skipEnrichment && missing.length > 0) {
      enrichmentCalls++
      enrichment = await draftEnrichment({
        domain: opts.domain,
        pageRoleLabel: PAGE_ROLE_LABEL[group.pageRole],
        rubricType: group.type,
        sampleBlock: sample,
        missing,
        pageMarkdown: findPageMarkdown(pages, sample.pageUrl),
      })
      inputTokens += enrichment.usage.input_tokens
      outputTokens += enrichment.usage.output_tokens
    }

    // 6. Projected score (deterministic — proposed properties added).
    const projected = projectScore(sample, proposedKeys).score
    const current = Math.round(validScores.reduce((a, s) => a + s.score, 0) / validScores.length)
    const rubric = RUBRICS[group.type]

    templateReports.push({
      type: group.type,
      label: rubric.italianLabel,
      pageRole: group.pageRole,
      pageRoleLabel: PAGE_ROLE_LABEL[group.pageRole],
      occurrences: group.blocks.length,
      pagesCrawled: pages.length,
      score: current,
      projectedScore: projected,
      projectedDelta: projected - current,
      presentProperties: Array.from(allPresent).sort(),
      missingRequired: sampleScore.missingRequired.map(p => ({ key: p.key, why: p.why })),
      missingRecommendedGoogle: sampleScore.missingRecommendedGoogle.map(p => ({ key: p.key, why: p.why })),
      missingRecommendedSchema: sampleScore.missingRecommendedSchema.map(p => ({ key: p.key, why: p.why })),
      sampleUrl: sample.pageUrl,
      sampleRaw: sample.raw,
      enrichment,
    })
  }

  templateReports.sort((a, b) => b.projectedDelta - a.projectedDelta)

  // 7. Opportunities (templates totally absent but with matching roles).
  const opportunities = detectOpportunities(pages, new Set(groups.keys()))

  // 8. OpenGraph summary.
  const ogKeys = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:site_name', 'twitter:card']
  const missingByTag: Record<string, number> = Object.fromEntries(ogKeys.map(k => [k, 0]))
  let totalOgTags = 0
  let pagesWithFullOg = 0
  for (const p of pages) {
    totalOgTags += Object.keys(p.openGraph.tags).length
    let fullOg = true
    for (const k of ogKeys) {
      if (!p.openGraph.tags[k]) {
        missingByTag[k]++
        fullOg = false
      }
    }
    if (fullOg) pagesWithFullOg++
  }

  // 9. Overall score: average of template scores + projected.
  const templateScores = templateReports.map(t => t.score)
  const projectedScores = templateReports.map(t => t.projectedScore)
  const currentOverall = overallScore(templateScores)
  const projectedOverall = overallScore(projectedScores)

  // 10. Page-role summary.
  const roleAgg = new Map<PageRole, { pages: number; templates: Set<string> }>()
  for (const p of pages) {
    const e = roleAgg.get(p.role) ?? { pages: 0, templates: new Set<string>() }
    e.pages++
    for (const b of p.blocks) {
      const t = resolveType(b.type)
      if (t) e.templates.add(t)
    }
    roleAgg.set(p.role, e)
  }
  const pageRoleSummary: PageRoleSummary[] = Array.from(roleAgg.entries()).map(([role, e]) => ({
    role,
    label: PAGE_ROLE_LABEL[role],
    pages: e.pages,
    templatesCovered: e.templates.size,
  })).sort((a, b) => b.pages - a.pages)

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    pagesAnalyzed,
    totalBlocks,
    templates: templateReports,
    openGraph: {
      averageTags: pages.length > 0 ? Math.round(totalOgTags / pages.length) : 0,
      pagesWithFullOg,
      missingByTag,
    },
    overall: {
      currentScore: currentOverall,
      projectedScore: projectedOverall,
      delta: projectedOverall - currentOverall,
    },
    pageRoleSummary,
    opportunities,
    usage: {
      enrichmentCalls,
      inputTokens,
      outputTokens,
    },
    discovery: {
      source: discovery.source,
      sitemapSize: discovery.sitemapSize,
      requested: urls.length,
      actuallyScraped: pages.length,
    },
  }
}

function findPageMarkdown(pages: PageScrapeResult[], pageUrl: string): string | null {
  for (const p of pages) {
    if (p.url === pageUrl) return p.scrape.markdown ?? null
  }
  return null
}

/**
 * Single-template refresh: re-scrape the sample page and re-enrich just that
 * template. Used by the `↻ Rilancia` button on each card.
 */
export async function refreshTemplate(opts: {
  domain: string
  rubricType: string
  pageRole: PageRole
  sampleUrl: string
}): Promise<TemplateReport | null> {
  const scrape = await scrapeWithFirecrawl(opts.sampleUrl, {
    formats: ['html', 'markdown'],
    waitFor: SCRAPE_WAIT_MS,
  })
  if (!scrape.ok || !scrape.html) return null
  const blocks = extractSchemaBlocks(scrape.html, opts.sampleUrl)
  const matching = blocks.find(b => resolveType(b.type) === opts.rubricType)
  if (!matching) return null

  const blockScore = scoreBlock(matching)
  const missing = [
    ...blockScore.missingRequired,
    ...blockScore.missingRecommendedGoogle,
    ...blockScore.missingRecommendedSchema,
  ]
  const proposedKeys = missing.map(m => m.key)
  const projected = projectScore(matching, proposedKeys).score
  const rubric = RUBRICS[opts.rubricType]

  let enrichment: EnrichmentProposal | null = null
  if (missing.length > 0) {
    enrichment = await draftEnrichment({
      domain: opts.domain,
      pageRoleLabel: PAGE_ROLE_LABEL[opts.pageRole],
      rubricType: opts.rubricType,
      sampleBlock: matching,
      missing,
      pageMarkdown: scrape.markdown,
    })
  }

  return {
    type: opts.rubricType,
    label: rubric.italianLabel,
    pageRole: opts.pageRole,
    pageRoleLabel: PAGE_ROLE_LABEL[opts.pageRole],
    occurrences: 1,
    pagesCrawled: 1,
    score: blockScore.score,
    projectedScore: projected,
    projectedDelta: projected - blockScore.score,
    presentProperties: blockScore.present,
    missingRequired: blockScore.missingRequired.map(p => ({ key: p.key, why: p.why })),
    missingRecommendedGoogle: blockScore.missingRecommendedGoogle.map(p => ({ key: p.key, why: p.why })),
    missingRecommendedSchema: blockScore.missingRecommendedSchema.map(p => ({ key: p.key, why: p.why })),
    sampleUrl: opts.sampleUrl,
    sampleRaw: matching.raw,
    enrichment,
  }
}
