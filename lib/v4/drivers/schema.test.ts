/**
 * V4 Schema driver — tests.
 *
 * Run: npx tsx --test lib/v4/drivers/schema.test.ts
 *
 * No network: `globalThis.fetch` is stubbed. The behaviours worth protecting
 * are the rubric boundaries and, above all, that a scrape failure produces an
 * error rather than a 0 — the V1 Schema bug this driver exists to prevent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MARKUP_KB,
  MARKUP_TYPES,
  NEUTRAL_CLUSTERS,
  PRESET_CLUSTERS,
  computeSchemaScore,
  resolveClusters,
  scoreMarkupType,
  type ClusterMap,
  type MarkupObservation,
  type MarkupType,
  type MarkupTypeScore,
} from './schema-kb'
import { collectJsonLdNodes, observeSite, schemaWorker, type PageScrape } from './schema'
import type { AnalysisSite, DriverJobContext } from '@/lib/v4/runner/types'

const SITES: AnalysisSite[] = [
  { site_ref: 'client', domain: 'client.com', name: 'Client', is_client: true },
  { site_ref: 'competitor_1', domain: 'comp1.com', name: 'C1', is_client: false },
]

function ctx(overrides: Partial<DriverJobContext> = {}): DriverJobContext {
  return {
    analysisId: 'analysis-1',
    driverKey: 'schema',
    sites: SITES,
    templates: [],
    config: {},
    refDate: '2026-06-30',
    country: 'it',
    deadlineAt: Date.now() + 60_000,
    ...overrides,
  }
}

/** Stub fetch, handing the handler the POSTed Firecrawl body. */
async function withFirecrawl(
  handler: (url: string) => { status?: number; body?: unknown },
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const posted = JSON.parse(String(init?.body ?? '{}')) as { url?: string }
    const { status = 200, body = {} } = handler(posted.url ?? '')
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response
  }) as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = original
  }
}

const ORG = MARKUP_KB.Organization

/** An observation of Organization with the given property set on one page. */
function orgObs(properties: string[], over: Partial<MarkupObservation> = {}): MarkupObservation {
  return {
    nodes: properties.length === 0 ? [] : [{ url: 'https://client.com', properties }],
    pagesScraped: 1,
    pagesWithType: 1,
    coherent: true,
    valid: true,
    ...over,
  }
}

const ORG_ALL = [...ORG.mandatory, ...ORG.recommended, ...ORG.advanced]

// ---------------------------------------------------------------------------
// Rubric — one test per level
// ---------------------------------------------------------------------------

test('rubric 0.00: the markup type is absent', () => {
  const s = scoreMarkupType('Organization', {
    nodes: [],
    pagesScraped: 3,
    pagesWithType: 0,
    coherent: false,
    valid: true,
  })
  assert.equal(s.level, 0)
  assert.match(s.reason, /absent/)
  assert.equal(s.coverage, 0)
})

test('rubric 0.00: present but not coherent with the page scores 0, not 0.25', () => {
  const s = scoreMarkupType('Organization', orgObs(ORG_ALL, { coherent: false }))
  assert.equal(s.level, 0)
  assert.match(s.reason, /does not describe the page content/)
})

test('rubric 0.25: a mandatory property is missing', () => {
  const s = scoreMarkupType('Organization', orgObs(['name']))
  assert.equal(s.level, 0.25)
  assert.deepEqual(s.missingMandatory, ['url'])
})

test('rubric 0.50: all mandatory present, recommended missing', () => {
  const s = scoreMarkupType('Organization', orgObs([...ORG.mandatory]))
  assert.equal(s.level, 0.5)
  assert.deepEqual(s.missingMandatory, [])
  assert.deepEqual(s.missingRecommended, ORG.recommended)
})

test('rubric 0.75: mandatory + recommended present, advanced missing', () => {
  const s = scoreMarkupType('Organization', orgObs([...ORG.mandatory, ...ORG.recommended]))
  assert.equal(s.level, 0.75)
  assert.deepEqual(s.missingAdvanced, ORG.advanced)
})

test('rubric 1.00: complete, sitewide and valid', () => {
  const s = scoreMarkupType('Organization', orgObs(ORG_ALL))
  assert.equal(s.level, 1)
  assert.equal(s.coverage, 1)
})

test('rubric: a property missing on ONE node of many is missing for the whole site', () => {
  const s = scoreMarkupType('Organization', {
    nodes: [
      { url: 'a', properties: ORG_ALL },
      { url: 'b', properties: ORG_ALL.filter((p) => p !== 'logo') },
    ],
    pagesScraped: 2,
    pagesWithType: 2,
    coherent: true,
    valid: true,
  })
  assert.equal(s.level, 0.5)
  assert.deepEqual(s.missingRecommended, ['logo'])
})

test('rubric: invalid JSON-LD blocks a 1.00 but does not zero the type', () => {
  const s = scoreMarkupType('Organization', orgObs(ORG_ALL, { valid: false }))
  assert.equal(s.level, 0.75)
  assert.match(s.reason, /failed to parse/)
})

// ---------------------------------------------------------------------------
// Sitewide coverage
// ---------------------------------------------------------------------------

test('sitewide: complete markup on 3 of 4 scraped pages is 0.75, not 1.00', () => {
  const s = scoreMarkupType('Organization', {
    nodes: [
      { url: 'a', properties: ORG_ALL },
      { url: 'b', properties: ORG_ALL },
      { url: 'c', properties: ORG_ALL },
    ],
    pagesScraped: 4,
    pagesWithType: 3,
    coherent: true,
    valid: true,
  })
  assert.equal(s.level, 0.75)
  assert.equal(s.coverage, 0.75)
  assert.match(s.reason, /3\/4 page\(s\) is below the 95% sitewide threshold/)
})

test('sitewide: coverage is reported against the pages actually scraped', () => {
  const pages: PageScrape[] = [
    { url: 'https://client.com/', nodes: [{ types: ['Organization'], properties: ORG_ALL }], parseErrors: 0, blockCount: 1 },
    { url: 'https://client.com/a', nodes: [], parseErrors: 0, blockCount: 0 },
  ]
  const obs = observeSite(pages, 'Organization')
  assert.equal(obs.pagesScraped, 2)
  assert.equal(obs.pagesWithType, 1)
  assert.equal(scoreMarkupType('Organization', obs).coverage, 0.5)
})

test('observeSite: a type declared with no mandatory property at all is a shell', () => {
  const pages: PageScrape[] = [
    { url: 'u', nodes: [{ types: ['Organization'], properties: ['@id'] }], parseErrors: 0, blockCount: 1 },
  ]
  const obs = observeSite(pages, 'Organization')
  assert.equal(obs.coherent, false)
  assert.equal(scoreMarkupType('Organization', obs).level, 0)
})

test('observeSite: a parse error on a page carrying the type invalidates it', () => {
  const pages: PageScrape[] = [
    { url: 'u', nodes: [{ types: ['Organization'], properties: ORG_ALL }], parseErrors: 1, blockCount: 2 },
  ]
  assert.equal(observeSite(pages, 'Organization').valid, false)
})

// ---------------------------------------------------------------------------
// Cluster weighting
// ---------------------------------------------------------------------------

/** A scoreOf that returns a fixed level per type, for weighting arithmetic. */
function fixedScores(levels: Partial<Record<MarkupType, number>>) {
  return (type: MarkupType): MarkupTypeScore => ({
    type,
    level: (levels[type] ?? 0) as MarkupTypeScore['level'],
    reason: 'fixture',
    missingMandatory: [],
    missingRecommended: [],
    missingAdvanced: [],
    coverage: 1,
    pagesScraped: 1,
    pagesWithType: 1,
    nodeCount: 1,
    valid: true,
  })
}

test('weighting: core 50% / content_local 35% / supporting 15%', () => {
  const clusters: ClusterMap = {
    core: ['Organization'],
    content_local: ['FAQPage'],
    supporting: ['ContactPage'],
  }
  const out = computeSchemaScore(
    clusters,
    fixedScores({ Organization: 1, FAQPage: 0.5, ContactPage: 0 }),
  )
  // 1*0.50 + 0.5*0.35 + 0*0.15 = 0.675
  assert.equal(Math.round(out.score * 100) / 100, 67.5)
  assert.equal(out.weightsRenormalized, false)
})

test('weighting: a type the preset expects but the site lacks is a 0 inside the mean', () => {
  const clusters: ClusterMap = {
    core: ['Organization', 'BreadcrumbList'],
    content_local: ['FAQPage'],
    supporting: ['ContactPage'],
  }
  // core mean = (1 + 0) / 2 = 0.5 -> 25 points, nothing else scores.
  const out = computeSchemaScore(clusters, fixedScores({ Organization: 1 }))
  assert.equal(out.score, 25)
  assert.equal(out.clusters.find((c) => c.cluster === 'core')?.mean, 0.5)
})

test('weighting: an empty cluster renormalizes the others instead of inventing a 0', () => {
  const clusters: ClusterMap = { core: ['Organization'], content_local: [], supporting: ['ContactPage'] }
  const out = computeSchemaScore(clusters, fixedScores({ Organization: 1, ContactPage: 1 }))
  assert.equal(out.weightsRenormalized, true)
  assert.equal(Math.round(out.score), 100)
})

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

test('presets: the cluster membership changes, the weights never do', () => {
  assert.ok(PRESET_CLUSTERS.retail_luxury.core.includes('Product'))
  assert.ok(!PRESET_CLUSTERS.banking_finance.core.includes('Product'))
  assert.ok(PRESET_CLUSTERS.banking_finance.core.includes('FinancialProduct'))

  const scoreOf = fixedScores({ Product: 1, FinancialProduct: 0 })
  const retail = computeSchemaScore(PRESET_CLUSTERS.retail_luxury, scoreOf)
  const banking = computeSchemaScore(PRESET_CLUSTERS.banking_finance, scoreOf)
  // Same site, same markup: worth 1/3 of the core cluster in retail, nothing
  // in banking. Only membership moved.
  assert.ok(retail.score > banking.score)
  assert.equal(banking.score, 0)
  for (const out of [retail, banking]) {
    assert.deepEqual(
      out.clusters.map((c) => c.weight),
      [0.5, 0.35, 0.15],
    )
  }
})

test('presets: every preset maps only known KB types and leaves no cluster empty', () => {
  for (const [preset, clusters] of Object.entries(PRESET_CLUSTERS)) {
    for (const [key, types] of Object.entries(clusters)) {
      assert.ok(types.length > 0, `${preset}.${key} is empty`)
      for (const t of types) {
        assert.ok((MARKUP_TYPES as readonly string[]).includes(t), `${preset}.${key}: ${t}`)
      }
    }
  }
})

test('presets: a missing industry_preset falls back to the neutral map and says so', () => {
  const r = resolveClusters(undefined)
  assert.equal(r.preset, null)
  assert.equal(r.source, 'neutral_fallback')
  assert.deepEqual(r.clusters, NEUTRAL_CLUSTERS)
})

test('presets: an unknown industry_preset is reported, never silently defaulted', () => {
  const r = resolveClusters('crypto_casino')
  assert.equal(r.preset, null)
  assert.equal(r.source, 'unknown_preset_fallback')
})

test('presets: a valid industry_preset resolves to its own map', () => {
  const r = resolveClusters('travel_hospitality')
  assert.equal(r.preset, 'travel_hospitality')
  assert.equal(r.source, 'preset')
  assert.ok(r.clusters.core.includes('TouristTrip'))
})

// ---------------------------------------------------------------------------
// JSON-LD extraction
// ---------------------------------------------------------------------------

test('collectJsonLdNodes: reads @graph and arrays, ignores nested sub-objects', () => {
  const nodes = collectJsonLdNodes({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'X', url: 'https://x.com' },
      // The publisher nested inside the Article must NOT count as a
      // standalone Organization node.
      { '@type': 'Article', headline: 'H', publisher: { '@type': 'Organization', name: 'X' } },
    ],
  })
  assert.deepEqual(
    nodes.map((n) => n.types[0]),
    ['Organization', 'Article'],
  )
  assert.deepEqual(nodes[0].properties.sort(), ['@type', 'name', 'url'])
})

// ---------------------------------------------------------------------------
// Worker, over a stubbed network
// ---------------------------------------------------------------------------

function firecrawlOk(html: string) {
  return { body: { success: true, data: { rawHtml: html, metadata: {} } } }
}

function jsonLd(payload: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(payload)}</script></head><body>x</body></html>`
}

const COMPLETE_ORG = Object.fromEntries(ORG_ALL.map((p) => [p, 'v']))

test('worker: scores the client from real markup, with the neutral preset flagged', async () => {
  process.env.FIRECRAWL_API_KEY = 'test-key'
  await withFirecrawl(
    () => firecrawlOk(jsonLd({ '@context': 'https://schema.org', '@type': 'Organization', ...COMPLETE_ORG })),
    async () => {
      const out = await schemaWorker(ctx())
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      // Neutral core = [Organization, BreadcrumbList] -> (1 + 0)/2 * 0.50 = 25.
      assert.equal(out.sites.find((s) => s.site_ref === 'client')?.raw, 25)
      const payload = out.rawPayload as { preset_source: string; preset_note: string }
      assert.equal(payload.preset_source, 'neutral_fallback')
      assert.match(payload.preset_note, /not industry-calibrated/)
    },
  )
})

test('worker: the evidence names the pages, the levels and the coverage basis', async () => {
  process.env.FIRECRAWL_API_KEY = 'test-key'
  await withFirecrawl(
    () => firecrawlOk(jsonLd({ '@type': 'Organization', name: 'X' })),
    async () => {
      const out = await schemaWorker(ctx())
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      const ev = out.sites[0].evidence as {
        pages_scraped: Array<{ url: string }>
        coverage_basis: string
        clusters: Array<{ cluster: string; types: Array<{ type: string; level: number; reason: string }> }>
      }
      assert.deepEqual(ev.pages_scraped.map((p) => p.url), ['https://client.com'])
      assert.match(ev.coverage_basis, /1 page\(s\) actually scraped/)
      const org = ev.clusters
        .find((c) => c.cluster === 'core')!
        .types.find((t) => t.type === 'Organization')!
      // name only: `url` is mandatory and missing.
      assert.equal(org.level, 0.25)
      assert.match(org.reason, /url/)
    },
  )
})

test('worker: a Firecrawl failure on a competitor leaves it unmeasured, never scored 0', async () => {
  process.env.FIRECRAWL_API_KEY = 'test-key'
  await withFirecrawl(
    (url) =>
      url.includes('comp1')
        ? { status: 403, body: { error: 'forbidden' } }
        : firecrawlOk(jsonLd({ '@type': 'Organization', ...COMPLETE_ORG })),
    async () => {
      const out = await schemaWorker(ctx())
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.deepEqual(out.sites.map((s) => s.site_ref), ['client'])
      const payload = out.rawPayload as { unmeasured: string[]; errors: string[] }
      assert.deepEqual(payload.unmeasured, ['comp1.com'])
      // The real reason survives, rather than becoming a zero.
      assert.match(payload.errors.join(' '), /HTTP 403/)
    },
  )
})

test('worker: an unscrapable client is an error carrying the real detail, not a 0', async () => {
  process.env.FIRECRAWL_API_KEY = 'test-key'
  await withFirecrawl(
    (url) =>
      url.includes('client')
        ? { status: 500, body: { error: 'upstream exploded' } }
        : firecrawlOk(jsonLd({ '@type': 'Organization', ...COMPLETE_ORG })),
    async () => {
      const out = await schemaWorker(ctx())
      assert.equal(out.status, 'error')
      if (out.status !== 'error') return
      assert.match(out.error, /HTTP 500/)
      assert.doesNotMatch(out.error, /score/)
    },
  )
})

test('worker: no Firecrawl credentials is an error for every site, not a set of zeros', async () => {
  const saved = process.env.FIRECRAWL_API_KEY
  delete process.env.FIRECRAWL_API_KEY
  try {
    const out = await schemaWorker(ctx())
    assert.equal(out.status, 'error')
    if (out.status !== 'error') return
    assert.match(out.error, /FIRECRAWL_API_KEY not configured/)
  } finally {
    if (saved) process.env.FIRECRAWL_API_KEY = saved
  }
})

test('worker: a page with no JSON-LD at all is a real 0, not a failure', async () => {
  process.env.FIRECRAWL_API_KEY = 'test-key'
  await withFirecrawl(
    () => firecrawlOk('<html><head></head><body>no markup here</body></html>'),
    async () => {
      const out = await schemaWorker(ctx())
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.equal(out.sites.find((s) => s.site_ref === 'client')?.raw, 0)
    },
  )
})

test('worker: honours the configured page templates and multi-page coverage', async () => {
  process.env.FIRECRAWL_API_KEY = 'test-key'
  const c = ctx({
    templates: [
      { site_ref: 'client', template_key: 'homepage', url: 'https://client.com/', applies_to: [] },
      { site_ref: 'client', template_key: 'pdp', url: 'https://client.com/p/1', applies_to: [] },
      { site_ref: 'competitor_1', template_key: 'homepage', url: 'https://comp1.com/', applies_to: [] },
    ],
    config: { industry_preset: 'b2b_services' },
  })
  await withFirecrawl(
    (url) =>
      url === 'https://client.com/'
        ? firecrawlOk(jsonLd({ '@type': 'Organization', ...COMPLETE_ORG }))
        : firecrawlOk('<html><body>nothing</body></html>'),
    async () => {
      const out = await schemaWorker(c)
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      const ev = out.sites.find((s) => s.site_ref === 'client')!.evidence as {
        pages_scraped: Array<{ url: string }>
        clusters: Array<{ cluster: string; types: Array<{ type: string; level: number; coverage_pct: number }> }>
      }
      assert.equal(ev.pages_scraped.length, 2)
      const org = ev.clusters
        .find((c2) => c2.cluster === 'core')!
        .types.find((t) => t.type === 'Organization')!
      // Complete markup, but only on 1 of the 2 pages measured.
      assert.equal(org.coverage_pct, 50)
      assert.equal(org.level, 0.75)
      assert.equal((out.rawPayload as { industry_preset: string }).industry_preset, 'b2b_services')
    },
  )
})
