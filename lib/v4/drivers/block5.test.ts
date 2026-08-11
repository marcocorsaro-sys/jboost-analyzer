/**
 * V4 Block 5 — driver tests (Discoverability, Awareness, Content,
 * AI Visibility, Traffic).
 *
 * Run: npx tsx --test lib/v4/drivers/block5.test.ts
 * No network: `globalThis.fetch` is stubbed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  activeTier,
  countAtTier,
  nextTier,
  tierRule,
  discoverabilityWorker,
} from './discoverability'
import { brandTerms, domainSegment, sumBrandedVolume, awarenessWorker } from './awareness'
import { classifyIssue, computeContent } from './content'
import { parseAiVisibilityDecision, aiVisibilityWorker } from './ai-visibility'
import { trafficWorker } from './traffic'
import { DriverSourceError } from './source'
import type { AnalysisSite, DriverJobContext } from '@/lib/v4/runner/types'
import type { SemrushSiteIssue } from '@/lib/seo-apis/types'

const SITES: AnalysisSite[] = [
  {
    site_ref: 'client',
    domain: 'client.com',
    name: 'Client',
    is_client: true,
    brand_name: 'Client',
    brand_variants: ['client group'],
  },
  {
    site_ref: 'competitor_1',
    domain: 'comp1.com',
    name: 'C1',
    is_client: false,
    brand_name: 'Comp One',
    brand_variants: [],
  },
]

function ctx(overrides: Partial<DriverJobContext> = {}): DriverJobContext {
  return {
    analysisId: 'analysis-1',
    driverKey: 'discoverability',
    sites: SITES,
    templates: [],
    config: {},
    refDate: '2026-06-30',
    country: 'it',
    deadlineAt: Date.now() + 60_000,
    ...overrides,
  }
}

async function withFetch(
  handler: (url: string) => { status?: number; body?: unknown },
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const { status = 200, body = {} } = handler(String(input))
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

// ---------------------------------------------------------------------------
// Discoverability — tier cascade
// ---------------------------------------------------------------------------

const KEYWORDS = [
  { keyword: 'a', volume: 5000, position: 3 }, // strict
  { keyword: 'b', volume: 1200, position: 9 }, // strict
  { keyword: 'c', volume: 800, position: 15 }, // relaxed_2
  { keyword: 'd', volume: 150, position: 60 }, // relaxed_3
  { keyword: 'e', volume: 50, position: 200 }, // nothing
]

test('discoverability: the strict tier counts only top-10 high-volume keywords', () => {
  assert.equal(countAtTier(KEYWORDS, tierRule('strict')).length, 2)
})

test('discoverability: each looser tier is a superset of the previous one', () => {
  const strict = countAtTier(KEYWORDS, tierRule('strict')).length
  const r2 = countAtTier(KEYWORDS, tierRule('relaxed_2')).length
  const r3 = countAtTier(KEYWORDS, tierRule('relaxed_3')).length
  assert.ok(strict <= r2 && r2 <= r3, `${strict} <= ${r2} <= ${r3}`)
  assert.equal(r3, 4) // 'e' never qualifies
})

test('discoverability: the default tier is strict and extends one step at a time', () => {
  assert.equal(activeTier(null), 'strict')
  assert.equal(activeTier({ tier: 'relaxed_2' }), 'relaxed_2')
  // An unknown tier must not be honoured.
  assert.equal(activeTier({ tier: 'anything' }), 'strict')
  assert.equal(nextTier('strict'), 'relaxed_2')
  assert.equal(nextTier('relaxed_3'), null)
})

test('discoverability: an empty player pauses the job instead of scoring 0', async () => {
  process.env.AHREFS_API_KEY = 'test-key'
  await withFetch(
    (url) => ({
      body: {
        keywords: url.includes('comp1')
          ? [{ keyword: 'x', volume: 10, best_position: 90 }] // nothing in strict
          : KEYWORDS.map((k) => ({ keyword: k.keyword, volume: k.volume, best_position: k.position })),
      },
    }),
    async () => {
      const out = await discoverabilityWorker(ctx())
      assert.equal(out.status, 'needs_decision')
      if (out.status !== 'needs_decision') return
      const req = out.decisionRequest as { empty_players: string[]; options: string[]; next_tier: string }
      assert.deepEqual(req.empty_players, ['comp1.com'])
      assert.deepEqual(req.options, ['remove', 'replace', 'extend'])
      assert.equal(req.next_tier, 'relaxed_2')
    },
  )
})

test('discoverability: extending the tier applies to the whole set', async () => {
  process.env.AHREFS_API_KEY = 'test-key'
  await withFetch(
    (url) => ({
      body: {
        keywords: url.includes('comp1')
          ? [{ keyword: 'x', volume: 600, best_position: 18 }] // qualifies only from relaxed_2
          : KEYWORDS.map((k) => ({ keyword: k.keyword, volume: k.volume, best_position: k.position })),
      },
    }),
    async () => {
      const out = await discoverabilityWorker(ctx({ decisionTaken: { tier: 'relaxed_2' } }))
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.equal(out.tierUsed, 'relaxed_2')
      // The client is counted at the SAME tier, not left at strict.
      assert.equal(out.sites.find((s) => s.site_ref === 'client')?.raw, 3)
      assert.equal(out.sites.find((s) => s.site_ref === 'competitor_1')?.raw, 1)
    },
  )
})

test('discoverability: a player the analyst removed is not measured again', async () => {
  process.env.AHREFS_API_KEY = 'test-key'
  await withFetch(
    () => ({
      body: {
        keywords: KEYWORDS.map((k) => ({ keyword: k.keyword, volume: k.volume, best_position: k.position })),
      },
    }),
    async () => {
      const out = await discoverabilityWorker(ctx({ decisionTaken: { removed: ['comp1.com'] } }))
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.deepEqual(out.sites.map((s) => s.site_ref), ['client'])
    },
  )
})

test('discoverability: an Ahrefs 403 on the client blocks the driver', async () => {
  process.env.AHREFS_API_KEY = 'test-key'
  await withFetch(
    () => ({ status: 403, body: {} }),
    async () => {
      const out = await discoverabilityWorker(ctx())
      assert.equal(out.status, 'error')
      if (out.status !== 'error') return
      assert.match(out.error, /403/)
    },
  )
})

// ---------------------------------------------------------------------------
// Awareness
// ---------------------------------------------------------------------------

test('awareness: brand terms = seed + variants + domain segment + space-less variants', () => {
  assert.deepEqual(brandTerms(SITES[0]), ['client', 'client group', 'clientgroup'])
  // The domain segment is always part of the terms (Bibbia 8c).
  assert.deepEqual(
    brandTerms({ ...SITES[1], brand_name: null, brand_variants: [] }),
    ['comp1'],
  )
  assert.equal(domainSegment('www.benetton.com'), 'benetton')
})

test('awareness: domain-grounded — only the domain keywords containing a brand term count', () => {
  const { total, matched } = sumBrandedVolume(
    [
      { keyword: 'client shoes', volume: 1000, position: 3 },
      { keyword: 'best client group offers', volume: 250, position: 40 },
      { keyword: 'running shoes', volume: 99999, position: 2 }, // non-brand: never counted
    ],
    ['client', 'client group'],
  )
  assert.equal(total, 1250)
  assert.equal(matched.length, 2)
})

test('awareness: an ambiguous token cannot inflate — the domain does not rank for it', () => {
  // The "brendan fraser" case: on the keyword UNIVERSE this exploded; on the
  // domain's own keywords the unrelated term simply is not in the list.
  const { total } = sumBrandedVolume(
    [{ keyword: 'fraser yachts charter', volume: 800, position: 5 }],
    ['fraser'],
  )
  assert.equal(total, 800)
})

test('awareness: a site with no seed is measured from the domain segment, flagged', async () => {
  process.env.AHREFS_API_KEY = 'test-key'
  await withFetch(
    () => ({ body: { keywords: [{ keyword: 'comp1 reviews', volume: 120, best_position: 8 }] } }),
    async () => {
      const sites = [SITES[0], { ...SITES[1], brand_name: null, brand_variants: [] }]
      const out = await awarenessWorker(ctx({ sites }))
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      const comp = out.sites.find((s) => s.site_ref === 'competitor_1')
      assert.equal(comp?.raw, 120)
      assert.equal((comp?.evidence as { seed_only_from_domain: boolean }).seed_only_from_domain, true)
    },
  )
})

test('awareness: the raw is the branded volume captured by the domain', async () => {
  process.env.AHREFS_API_KEY = 'test-key'
  await withFetch(
    () => ({
      body: {
        keywords: [
          { keyword: 'client store', volume: 1000, best_position: 1 },
          { keyword: 'client group careers', volume: 250, best_position: 12 },
        ],
      },
    }),
    async () => {
      const out = await awarenessWorker(ctx())
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.equal(out.sites.find((s) => s.site_ref === 'client')?.raw, 1250)
      const ev = out.sites.find((s) => s.site_ref === 'client')?.evidence as {
        method: string
        kw_count: number
      }
      assert.equal(ev.method, 'domain-grounded')
      assert.equal(ev.kw_count, 2)
    },
  )
})

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function issue(title: string, pages: number, type: SemrushSiteIssue['type'] = 'error'): SemrushSiteIssue {
  return { id: title, title, type, pages_count: pages }
}

test('content: the three drivers partition the issues, never double-count', () => {
  assert.equal(classifyIssue(issue('Pages with low word count', 1)), 'content')
  assert.equal(classifyIssue(issue('Duplicate title tags', 1)), 'content')
  assert.equal(classifyIssue(issue('Images without alt attribute', 1)), 'content')
  assert.equal(classifyIssue(issue('Invalid structured data items', 1)), 'structured_data')
  assert.equal(classifyIssue(issue('4xx errors', 1)), 'technical')
})

test('content: score = 100 * (1 - content_errors/crawled_pages)', () => {
  const c = computeContent(
    [issue('Pages with low word count', 20), issue('4xx errors', 50), issue('Invalid structured data items', 30)],
    100,
  )
  assert.equal(c.contentErrors, 20)
  assert.equal(c.score, 80)
  // What the other drivers own is visible, not dropped.
  assert.equal(c.otherClasses.length, 2)
})

test('content: zero crawled pages is an error, not a 100', () => {
  assert.throws(() => computeContent([issue('Duplicate title tags', 1)], 0), DriverSourceError)
})

// ---------------------------------------------------------------------------
// AI Visibility — manual hand-off
// ---------------------------------------------------------------------------

test('ai visibility: with no operator input the job pauses, it does not score', async () => {
  const out = await aiVisibilityWorker(ctx({ driverKey: 'ai_visibility' }))
  assert.equal(out.status, 'needs_decision')
  if (out.status !== 'needs_decision') return
  assert.equal((out.decisionRequest as { reason: string }).reason, 'manual_input')
})

test('ai visibility: an out-of-range score is rejected', () => {
  assert.ok(parseAiVisibilityDecision({ score: 140 }).error)
  assert.ok(parseAiVisibilityDecision({ score: -1 }).error)
  assert.ok(parseAiVisibilityDecision({ score: 'abc' }).error)
  assert.equal(parseAiVisibilityDecision({ score: 62 }).decision?.score, 62)
})

test('ai visibility: a competitor left blank stays unmeasured, never 0', async () => {
  const out = await aiVisibilityWorker(
    ctx({ driverKey: 'ai_visibility', decisionTaken: { score: 62, comment: 'da J-Horizon' } }),
  )
  assert.equal(out.status, 'done')
  if (out.status !== 'done') return
  assert.deepEqual(out.sites.map((s) => s.site_ref), ['client'])
  assert.equal(out.sites[0].raw, 62)
  assert.deepEqual((out.rawPayload as { unmeasured: string[] }).unmeasured, ['comp1.com'])
})

test('ai visibility: competitor scores are matched by domain, case-insensitively', async () => {
  const out = await aiVisibilityWorker(
    ctx({ driverKey: 'ai_visibility', decisionTaken: { score: 62, competitors: { 'COMP1.com': 41 } } }),
  )
  assert.equal(out.status, 'done')
  if (out.status !== 'done') return
  assert.equal(out.sites.find((s) => s.site_ref === 'competitor_1')?.raw, 41)
})

// ---------------------------------------------------------------------------
// Traffic — explicit refusal
// ---------------------------------------------------------------------------

test('traffic: refuses by naming the missing source, never a substitute number', async () => {
  const out = await trafficWorker(ctx({ driverKey: 'traffic' }))
  assert.equal(out.status, 'error')
  if (out.status !== 'error') return
  assert.match(out.error, /SimilarWeb/)
  assert.match(out.error, /Semrush\/Ahrefs/)
})
