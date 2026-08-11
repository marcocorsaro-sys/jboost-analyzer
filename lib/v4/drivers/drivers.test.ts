/**
 * V4 Block 4 — driver tests.
 *
 * Run: npx tsx --test lib/v4/drivers/drivers.test.ts
 *
 * No network: `globalThis.fetch` is stubbed. That is deliberate for the worker
 * tests too, because the single most important behaviour of block 4 is what
 * happens when a source FAILS — the V1 clients answer failures with a
 * plausible mock (DR=50, PSI 0/0) and the V4 workers must refuse it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { requireLive, mapPool, mean, round, DriverSourceError } from './source'
import { computeCompliance, isStructuredDataIssue, complianceWorker } from './compliance'
import { urlsForSite, psiOutcome, type PsiSetResult } from './pagespeed'
import { authorityWorker } from './authority'
import { speedWorker } from './speed'
import type { AnalysisSite, DriverJobContext } from '@/lib/v4/runner/types'
import type { SemrushSiteIssue } from '@/lib/seo-apis/types'

const SITES: AnalysisSite[] = [
  { site_ref: 'client', domain: 'client.com', name: 'Client', is_client: true },
  { site_ref: 'competitor_1', domain: 'comp1.com', name: 'C1', is_client: false },
]

function ctx(overrides: Partial<DriverJobContext> = {}): DriverJobContext {
  return {
    analysisId: 'analysis-1',
    driverKey: 'authority',
    sites: SITES,
    templates: [],
    config: {},
    refDate: '2026-06-30',
    country: 'it',
    deadlineAt: Date.now() + 60_000,
    ...overrides,
  }
}

/** Install a fetch stub for the duration of one test. */
async function withFetch(
  handler: (url: string) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>,
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const { status = 200, body = {} } = await handler(url)
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
// source helpers
// ---------------------------------------------------------------------------

test('requireLive: a mock response is a failure, not a measurement', () => {
  assert.throws(
    () =>
      requireLive(
        { data: { domain_rating: 50 }, _meta: { is_mock: true, source: 'ahrefs_domain_rating', fetched_at: '' } },
        'Authority for x.com',
      ),
    DriverSourceError,
  )
})

test('requireLive: a live response passes through untouched', () => {
  const data = { domain_rating: 71 }
  assert.equal(
    requireLive({ data, _meta: { is_mock: false, source: 's', fetched_at: '' } }, 'x'),
    data,
  )
})

test('mapPool: preserves input order and respects the concurrency cap', async () => {
  let inFlight = 0
  let peak = 0
  const out = await mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight -= 1
    return n * 10
  })
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60])
  assert.ok(peak <= 2, `peak concurrency was ${peak}`)
})

test('mean/round: empty means null, not zero', () => {
  assert.equal(mean([]), null)
  assert.equal(mean([10, 20, 30]), 20)
  assert.equal(round(66.6666, 1), 66.7)
})

// ---------------------------------------------------------------------------
// compliance — raw = Semrush Site Health (Bibbia, Resolved 2026-06-22)
// ---------------------------------------------------------------------------

function issue(title: string, pages: number, type: SemrushSiteIssue['type'] = 'error'): SemrushSiteIssue {
  return { id: title, title, type, pages_count: pages }
}

test('compliance: raw IS the Site Health score, no custom formula', () => {
  const c = computeCompliance(82, [issue('Broken internal links', 10), issue('4xx errors', 15)])
  assert.equal(c.siteHealth, 82)
})

test('compliance: issues feed the qualitative table only, never the score', () => {
  const many = computeCompliance(82, [issue('4xx errors', 5000)])
  const none = computeCompliance(82, [])
  assert.equal(many.siteHealth, none.siteHealth)
})

test('compliance: the issues table is top-10 by pages, with ownership', () => {
  const issues = Array.from({ length: 15 }, (_, i) => issue(`Issue ${i}`, i + 1))
  issues.push(issue('Invalid structured data items', 100))
  const c = computeCompliance(50, issues)
  assert.equal(c.topIssues.length, 10)
  assert.equal(c.topIssues[0].title, 'Invalid structured data items')
  assert.equal(c.topIssues[0].owned_by, 'schema')
  assert.equal(c.topIssues[1].owned_by, 'compliance')
})

test('compliance: recognises the structured-data issue wordings', () => {
  for (const title of [
    'Invalid structured data items',
    'Pages with schema.org markup errors',
    'Missing JSON-LD',
    'Rich snippet errors',
  ]) {
    assert.ok(isStructuredDataIssue(issue(title, 1)), title)
  }
  assert.equal(isStructuredDataIssue(issue('Broken internal links', 1)), false)
})

test('compliance: a missing Site Health is an error, never a 0', () => {
  assert.throws(() => computeCompliance(null, []), DriverSourceError)
})

test('compliance: an out-of-range Site Health is rejected, not clamped', () => {
  assert.throws(() => computeCompliance(140, []), DriverSourceError)
  assert.throws(() => computeCompliance(-3, []), DriverSourceError)
})

// ---------------------------------------------------------------------------
// pagespeed — page selection and outcome shaping
// ---------------------------------------------------------------------------

test('pagespeed: falls back to the homepage when no templates are configured', () => {
  assert.deepEqual(urlsForSite(ctx(), SITES[0]), ['https://client.com'])
})

test('pagespeed: uses the configured templates when they exist', () => {
  const c = ctx({
    templates: [
      { site_ref: 'client', template_key: 'homepage', url: 'https://client.com/', applies_to: [] },
      { site_ref: 'client', template_key: 'pdp', url: 'https://client.com/p/1', applies_to: [] },
      // A template the site does not have: url null, must not be measured.
      { site_ref: 'client', template_key: 'faq', url: null, applies_to: [] },
      { site_ref: 'competitor_1', template_key: 'homepage', url: 'https://comp1.com/', applies_to: [] },
    ],
  })
  assert.deepEqual(urlsForSite(c, SITES[0]), ['https://client.com/', 'https://client.com/p/1'])
})

test('pagespeed: the scope is recorded, so a homepage-only score cannot be mistaken', () => {
  const result: PsiSetResult = {
    sites: [{ site_ref: 'client', domain: 'client.com', raw: 80 }],
    errors: [],
    measurements: [],
    templatesConfigured: false,
  }
  const out = psiOutcome(ctx(), 'performance', result, 'Speed')
  assert.equal(out.status, 'done')
  assert.match(String((out.rawPayload as { scope: string }).scope), /homepage only/)
})

test('pagespeed: no client measurement is an error, even if competitors succeeded', () => {
  const result: PsiSetResult = {
    sites: [{ site_ref: 'competitor_1', domain: 'comp1.com', raw: 80 }],
    errors: ['PageSpeed returned 429 for https://client.com (mobile)'],
    measurements: [],
    templatesConfigured: false,
  }
  const out = psiOutcome(ctx(), 'performance', result, 'Speed')
  assert.equal(out.status, 'error')
  assert.match(String(out.error), /429/)
})

// ---------------------------------------------------------------------------
// workers, over a stubbed network
// ---------------------------------------------------------------------------

test('authority: a real DR becomes the raw and the absolute score', async () => {
  process.env.AHREFS_API_KEY = 'test-key'
  await withFetch(
    (url) => ({ body: { domain_rating: url.includes('comp1') ? 40.4 : 71.6, ahrefs_rank: 1234 } }),
    async () => {
      const out = await authorityWorker(ctx())
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.equal(out.sites.length, 2)
      const client = out.sites.find((s) => s.site_ref === 'client')
      assert.equal(client?.raw, 72)
      assert.equal(client?.score_absolute, 72)
    },
  )
})

test('authority: an Ahrefs 403 must NOT score the client DR=50 (the V1 bug)', async () => {
  process.env.AHREFS_API_KEY = 'test-key'
  await withFetch(
    () => ({ status: 403, body: {} }),
    async () => {
      const out = await authorityWorker(ctx())
      // V1 fetchDomainRating answers a 403 with a mock DR=50. If that ever
      // reaches a score again, this assertion is the thing that fails.
      assert.equal(out.status, 'error')
      if (out.status !== 'error') return
      assert.match(out.error, /no live data/)
      assert.doesNotMatch(out.error, /\b50\b/)
    },
  )
})

test('authority: a failing competitor is reported unmeasured, never scored 0', async () => {
  process.env.AHREFS_API_KEY = 'test-key'
  await withFetch(
    (url) =>
      url.includes('comp1')
        ? { status: 403, body: {} }
        : { body: { domain_rating: 65, ahrefs_rank: 10 } },
    async () => {
      const out = await authorityWorker(ctx())
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.deepEqual(out.sites.map((s) => s.site_ref), ['client'])
      assert.deepEqual((out.rawPayload as { unmeasured: string[] }).unmeasured, ['comp1.com'])
    },
  )
})

test('speed: an incomplete Lighthouse result is an error, not a 0', async () => {
  process.env.GOOGLE_PSI_API_KEY = 'test-key'
  await withFetch(
    () => ({ body: { lighthouseResult: { categories: { performance: { score: null } } } } }),
    async () => {
      const out = await speedWorker(ctx())
      assert.equal(out.status, 'error')
      if (out.status !== 'error') return
      assert.match(out.error, /incomplete Lighthouse result/)
    },
  )
})

test('speed: averages the category over every (page, strategy) pair', async () => {
  process.env.GOOGLE_PSI_API_KEY = 'test-key'
  await withFetch(
    (url) => ({
      body: {
        lighthouseResult: {
          categories: {
            // mobile 0.40 / desktop 0.80 -> mean 60
            performance: { score: url.includes('strategy=mobile') ? 0.4 : 0.8 },
            accessibility: { score: 0.9 },
          },
        },
      },
    }),
    async () => {
      const out = await speedWorker(ctx())
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      const client = out.sites.find((s) => s.site_ref === 'client')
      assert.equal(client?.raw, 60)
      assert.equal((client?.evidence as { measured_runs: number }).measured_runs, 2)
    },
  )
})

test('compliance: the worker scores the Site Health of the live snapshot', async () => {
  process.env.SEMRUSH_API_KEY = 'test-key'
  await withFetch(
    (url) => {
      if (url.includes('/projects?')) {
        return {
          body: [
            { project_url: 'https://client.com', project_id: 1 },
            { project_url: 'https://comp1.com', project_id: 2 },
          ],
        }
      }
      if (url.includes('siteaudit/info')) {
        return {
          body: {
            quality: { value: url.includes('/1/') ? 82 : 64, delta: 1.5 },
            pages_crawled: 900,
          },
        }
      }
      return { body: { issues: [{ id: '1', title: '4xx errors', type: 'error', pages_count: 12 }] } }
    },
    async () => {
      const out = await complianceWorker(ctx())
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      const client = out.sites.find((s) => s.site_ref === 'client')
      assert.equal(client?.raw, 82)
      assert.equal(client?.score_absolute, 82)
      const ev = client?.evidence as { site_health_delta: number }
      assert.equal(ev.site_health_delta, 1.5)
      assert.equal(out.sites.find((s) => s.site_ref === 'competitor_1')?.raw, 64)
    },
  )
})

test('compliance: a domain with no SEMrush project is unmeasured, not scored', async () => {
  process.env.SEMRUSH_API_KEY = 'test-key'
  await withFetch(
    // Empty project list -> V1 returns a mock with pages_crawled 0.
    () => ({ body: [] }),
    async () => {
      const out = await complianceWorker(ctx())
      assert.equal(out.status, 'error')
      if (out.status !== 'error') return
      assert.match(out.error, /no live data/)
    },
  )
})
