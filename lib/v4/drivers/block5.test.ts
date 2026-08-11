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
import { computeSiteContent, contentWorker } from './content'
import { band, overallContent, templateScore, ContentScoreError } from '@/lib/v4/content/score'
import { parseAiVisibilityDecision, aiVisibilityWorker } from './ai-visibility'
import { parseExtraction, buildJhorizonPrompt } from './jhorizon-extract'
import { trafficWorker, averageLastMonths, trendPct } from './traffic'
import { visitsWindow } from './similarweb'
import type { AnalysisSite, ContentAnswerRow, DriverJobContext } from '@/lib/v4/runner/types'

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
// Content — questionnaire engine (sheets 9a/9b)
// ---------------------------------------------------------------------------

function answerRows(
  site_ref: ContentAnswerRow['site_ref'],
  template_key: string,
  answers: Record<number, 'A' | 'B' | 'C' | 'D' | null>,
): ContentAnswerRow[] {
  return Object.entries(answers).map(([q, selected]) => ({
    site_ref,
    template_key,
    question_num: Number(q),
    selected,
  }))
}

test('content: templateScore = 100 * points / template max (sum for consistent templates)', () => {
  const full = templateScore('plp', { 1: 'D', 2: 'D', 3: 'D', 4: 'D', 5: 'D' })
  assert.equal(full.score, 100)
  assert.equal(full.points, 100)
  assert.equal(full.maxPoints, 100)

  // PLP mixed: A=0, B=7, C=17, D=20, A=0 — for a 100-max template the score
  // IS the plain sum of the 9b points.
  const mixed = templateScore('plp', { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'A' })
  assert.equal(mixed.score, 44)
  assert.equal(mixed.perQuestion.length, 5)
})

test('content: the Article anomaly is absorbed — all Very good still scores 100', () => {
  // Article's 9b points max out at 85 (see bank header); dividing by the
  // template's own max keeps a perfect assessment at 100 instead of 85.
  const full = templateScore('article', { 1: 'D', 2: 'D', 3: 'D', 4: 'D', 6: 'D', 7: 'D' })
  assert.equal(full.points, 85)
  assert.equal(full.maxPoints, 85)
  assert.equal(full.score, 100)

  // C,C,A,D,B,D = 7+17+0+15+3+15 = 57 -> 100*57/85 = 67.1
  const mixed = templateScore('article', { 1: 'C', 2: 'C', 3: 'A', 4: 'D', 6: 'B', 7: 'D' })
  assert.equal(mixed.score, 67.1)
})

test('content: an incomplete template is an explicit error, never an implicit 0', () => {
  assert.throws(
    () => templateScore('plp', { 1: 'D', 2: 'D', 3: 'D', 4: 'D' }), // Q5 missing
    ContentScoreError,
  )
  assert.throws(() => templateScore('landing', { 1: 'A' }), ContentScoreError)
  assert.throws(
    () => templateScore('plp', { 1: 'E', 2: 'D', 3: 'D', 4: 'D', 5: 'D' }),
    ContentScoreError,
  )
})

test('content: overall = mean of compiled templates; nothing compiled = null, never 0', () => {
  assert.equal(overallContent([80, 60]), 70)
  assert.equal(overallContent([50, 55]), 52.5)
  assert.equal(overallContent([100]), 100)
  assert.equal(overallContent([]), null)
})

test('content: the 9a interpretation bands', () => {
  assert.equal(band(0), 'Critical')
  assert.equal(band(39.9), 'Critical')
  assert.equal(band(40), 'Weak')
  assert.equal(band(59.9), 'Weak')
  assert.equal(band(60), 'Good')
  assert.equal(band(79.9), 'Good')
  assert.equal(band(80), 'Excellent')
  assert.equal(band(100), 'Excellent')
})

test('content: a draft row without a selection is not an answer', () => {
  const rows = answerRows('client', 'global', { 1: 'D', 2: 'D', 3: 'D', 4: null })
  const computed = computeSiteContent(rows)
  assert.equal(computed.overall, null) // global is 3/4: not scorable
  assert.deepEqual(computed.incomplete, [{ template: 'global', answered: 3, total: 4 }])
})

test('content worker: no client questionnaire pauses the job, it does not score', async () => {
  const out = await contentWorker(ctx({ driverKey: 'content', contentAnswers: [] }))
  assert.equal(out.status, 'needs_decision')
  if (out.status !== 'needs_decision') return
  assert.equal((out.decisionRequest as { reason: string }).reason, 'questionnaire_missing')
  assert.match((out.decisionRequest as { message: string }).message, /questionario Content/)
})

test('content worker: a client with only incomplete templates still pauses, naming them', async () => {
  const out = await contentWorker(
    ctx({
      driverKey: 'content',
      contentAnswers: answerRows('client', 'global', { 1: 'D', 2: 'C', 3: 'B' }), // 3/4
    }),
  )
  assert.equal(out.status, 'needs_decision')
  if (out.status !== 'needs_decision') return
  const req = out.decisionRequest as { incomplete_templates: Array<{ template: string }> }
  assert.deepEqual(req.incomplete_templates, [{ template: 'global', answered: 3, total: 4 }])
})

test('content worker: compiled templates score, incomplete ones are excluded but visible', async () => {
  const out = await contentWorker(
    ctx({
      driverKey: 'content',
      contentAnswers: [
        // Global complete, all Very good -> 100.
        ...answerRows('client', 'global', { 1: 'D', 2: 'D', 3: 'D', 4: 'D' }),
        // Homepage complete, mixed: 17+6+20+0+10 = 53.
        ...answerRows('client', 'homepage', { 1: 'C', 2: 'B', 3: 'D', 4: 'A', 5: 'C' }),
        // PLP started but incomplete: excluded from the mean, reported.
        ...answerRows('client', 'plp', { 1: 'D', 2: 'D' }),
      ],
    }),
  )
  assert.equal(out.status, 'done')
  if (out.status !== 'done') return
  const client = out.sites.find((s) => s.site_ref === 'client')
  assert.equal(client?.raw, 76.5) // mean(100, 53)
  assert.equal(client?.score_absolute, 77)
  const ev = client?.evidence as {
    method: string
    templates_evaluated: number
    per_template: Array<{ template: string; score: number; band: string; answered: number }>
    templates_incomplete: Array<{ template: string }>
  }
  assert.equal(ev.method, 'questionnaire_9a_9b')
  assert.equal(ev.templates_evaluated, 2)
  assert.deepEqual(
    ev.per_template.find((t) => t.template === 'homepage'),
    { template: 'homepage', score: 53, band: 'Weak', answered: 5 },
  )
  assert.deepEqual(ev.templates_incomplete, [{ template: 'plp', answered: 2, total: 5 }])
})

test('content worker: a competitor without answers stays unmeasured, never 0', async () => {
  const out = await contentWorker(
    ctx({
      driverKey: 'content',
      contentAnswers: answerRows('client', 'global', { 1: 'D', 2: 'D', 3: 'D', 4: 'D' }),
    }),
  )
  assert.equal(out.status, 'done')
  if (out.status !== 'done') return
  assert.deepEqual(out.sites.map((s) => s.site_ref), ['client'])
  assert.deepEqual((out.rawPayload as { unmeasured: string[] }).unmeasured, ['comp1.com'])
})

test('content worker: a competitor with a compiled questionnaire gets its own score', async () => {
  const out = await contentWorker(
    ctx({
      driverKey: 'content',
      contentAnswers: [
        ...answerRows('client', 'global', { 1: 'D', 2: 'D', 3: 'D', 4: 'D' }),
        ...answerRows('competitor_1', 'global', { 1: 'B', 2: 'B', 3: 'B', 4: 'B' }), // 10+10+6+6 = 32
      ],
    }),
  )
  assert.equal(out.status, 'done')
  if (out.status !== 'done') return
  assert.equal(out.sites.find((s) => s.site_ref === 'competitor_1')?.raw, 32)
})

// ---------------------------------------------------------------------------
// AI Visibility — paste-driven flow (copy-prompt -> paste -> LLM extraction)
// ---------------------------------------------------------------------------

/** A stubbed Anthropic Messages response whose only text block is `text`. */
function anthropicBody(text: string): unknown {
  return { content: [{ type: 'text', text }] }
}

test('ai visibility: the first run pauses with a copy-prompt naming every domain', async () => {
  const out = await aiVisibilityWorker(ctx({ driverKey: 'ai_visibility' }))
  assert.equal(out.status, 'needs_decision')
  if (out.status !== 'needs_decision') return
  const req = out.decisionRequest as { reason: string; copy_prompt: string }
  assert.equal(req.reason, 'jhorizon_paste')
  assert.match(req.copy_prompt, /client\.com/)
  assert.match(req.copy_prompt, /comp1\.com/)
  assert.match(req.copy_prompt, /GEO Score/)
  // The pure builder is what the pause exposes.
  assert.equal(req.copy_prompt, buildJhorizonPrompt(SITES))
})

test('ai visibility: the pasted answer is extracted via LLM into per-site GEO scores', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  await withFetch(
    (url) => {
      assert.match(url, /api\.anthropic\.com/)
      return {
        body: anthropicBody(
          JSON.stringify({
            scores: [
              { site_ref: 'client', geo_score: 62.4 },
              { site_ref: 'competitor_1', geo_score: 41 },
            ],
            comment_absolute: 'Commento assoluto.',
            comment_relative: 'Commento relativo.',
          }),
        ),
      }
    },
    async () => {
      const out = await aiVisibilityWorker(
        ctx({ driverKey: 'ai_visibility', decisionTaken: { jhorizon_answer: 'risposta J-Horizon...' } }),
      )
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      const client = out.sites.find((s) => s.site_ref === 'client')
      assert.equal(client?.raw, 62.4)
      assert.equal(client?.score_absolute, 62) // the one Business driver with an Absolute view
      assert.equal(out.sites.find((s) => s.site_ref === 'competitor_1')?.raw, 41)
      assert.equal((client?.evidence as { method: string }).method, 'paste-driven')
      const payload = out.rawPayload as { comment_absolute: string; comment_relative: string }
      assert.equal(payload.comment_absolute, 'Commento assoluto.')
      assert.equal(payload.comment_relative, 'Commento relativo.')
    },
  )
})

test('ai visibility: a competitor the answer does not cover stays unmeasured, never 0', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  await withFetch(
    () => ({
      body: anthropicBody(
        JSON.stringify({
          scores: [
            { site_ref: 'client', geo_score: 70 },
            { site_ref: 'competitor_1', geo_score: null },
          ],
          comment_absolute: 'a',
          comment_relative: 'b',
        }),
      ),
    }),
    async () => {
      const out = await aiVisibilityWorker(
        ctx({ driverKey: 'ai_visibility', decisionTaken: { jhorizon_answer: 'testo' } }),
      )
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.deepEqual(out.sites.map((s) => s.site_ref), ['client'])
      assert.deepEqual((out.rawPayload as { unmeasured: string[] }).unmeasured, ['comp1.com'])
    },
  )
})

test('ai visibility: an answer that does not cover the client pauses again', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  await withFetch(
    () => ({
      body: anthropicBody(
        JSON.stringify({
          scores: [
            { site_ref: 'client', geo_score: null },
            { site_ref: 'competitor_1', geo_score: 55 },
          ],
          comment_absolute: 'a',
          comment_relative: 'b',
        }),
      ),
    }),
    async () => {
      const out = await aiVisibilityWorker(
        ctx({ driverKey: 'ai_visibility', decisionTaken: { jhorizon_answer: 'testo senza cliente' } }),
      )
      assert.equal(out.status, 'needs_decision')
      if (out.status !== 'needs_decision') return
      const req = out.decisionRequest as { reason: string; message: string; copy_prompt: string }
      assert.equal(req.reason, 'client_not_covered')
      assert.match(req.message, /non copre il sito cliente/)
      assert.match(req.message, /manualmente/) // the manual-score escape hatch is offered
      assert.ok(req.copy_prompt)
    },
  )
})

test('ai visibility: an extracted score outside 0-100 is an error, never clamped', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  await withFetch(
    () => ({
      body: anthropicBody(
        JSON.stringify({
          scores: [{ site_ref: 'client', geo_score: 140 }],
          comment_absolute: 'a',
          comment_relative: 'b',
        }),
      ),
    }),
    async () => {
      const out = await aiVisibilityWorker(
        ctx({ driverKey: 'ai_visibility', decisionTaken: { jhorizon_answer: 'testo' } }),
      )
      assert.equal(out.status, 'error')
      if (out.status !== 'error') return
      assert.match(out.error, /geo_score non valido/)
    },
  )
})

test('ai visibility: parseExtraction ignores unknown site_refs and keeps nulls', () => {
  const { extraction, error } = parseExtraction(
    JSON.stringify({
      scores: [
        { site_ref: 'client', geo_score: 50 },
        { site_ref: 'competitor_9', geo_score: 99 }, // not in the set: ignored
      ],
      comment_absolute: 'abs',
      comment_relative: 'rel',
    }),
    SITES,
  )
  assert.equal(error, null)
  assert.deepEqual(extraction?.scores, [
    { site_ref: 'client', geo_score: 50 },
    { site_ref: 'competitor_1', geo_score: null },
  ])
})

test('ai visibility: a manual override with explicit numbers never calls the LLM', async () => {
  let fetched = false
  await withFetch(
    () => {
      fetched = true
      return { status: 500, body: {} }
    },
    async () => {
      const out = await aiVisibilityWorker(
        ctx({ driverKey: 'ai_visibility', decisionTaken: { score: 62, competitors: { 'COMP1.com': 41 } } }),
      )
      assert.equal(fetched, false)
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.equal(out.sites.find((s) => s.site_ref === 'client')?.raw, 62)
      // Matched by domain, case-insensitively.
      assert.equal(out.sites.find((s) => s.site_ref === 'competitor_1')?.raw, 41)
      assert.equal((out.sites[0].evidence as { method: string }).method, 'manual')
    },
  )
})

test('ai visibility: a manual competitor left blank stays unmeasured, never 0', async () => {
  const out = await aiVisibilityWorker(
    ctx({ driverKey: 'ai_visibility', decisionTaken: { score: 62, comment: 'da J-Horizon' } }),
  )
  assert.equal(out.status, 'done')
  if (out.status !== 'done') return
  assert.deepEqual(out.sites.map((s) => s.site_ref), ['client'])
  assert.equal(out.sites[0].raw, 62)
  assert.deepEqual((out.rawPayload as { unmeasured: string[] }).unmeasured, ['comp1.com'])
})

test('ai visibility: an out-of-range manual score is rejected', () => {
  assert.ok(parseAiVisibilityDecision({ score: 140 }).error)
  assert.ok(parseAiVisibilityDecision({ score: -1 }).error)
  assert.ok(parseAiVisibilityDecision({ score: 'abc' }).error)
  assert.equal(parseAiVisibilityDecision({ score: 62 }).decision?.score, 62)
})

// ---------------------------------------------------------------------------
// Traffic — Similarweb visits, mean of the last 3 available months
// ---------------------------------------------------------------------------

/** URL helper: which site a stubbed Similarweb call is for. */
function similarwebVisits(perDomain: Record<string, Array<{ date: string; visits: number | null }> | number>) {
  return (url: string): { status?: number; body?: unknown } => {
    assert.match(url, /api\.similarweb\.com/)
    for (const [domain, value] of Object.entries(perDomain)) {
      if (url.includes(domain)) {
        if (typeof value === 'number') return { status: value, body: {} }
        return { body: { visits: value } }
      }
    }
    return { status: 404, body: {} }
  }
}

const SIX_MONTHS = [
  { date: '2025-12-01', visits: 1000 },
  { date: '2026-01-01', visits: 1100 },
  { date: '2026-02-01', visits: 1200 },
  { date: '2026-03-01', visits: 2000 },
  { date: '2026-04-01', visits: 3000 },
  { date: '2026-05-01', visits: 4000 },
]

test('traffic: the request window is REF_MONTH-6 .. REF_MONTH-1', () => {
  assert.deepEqual(visitsWindow('2026-06-30'), { start: '2025-12', end: '2026-05' })
  // Year boundary.
  assert.deepEqual(visitsWindow('2026-01-31'), { start: '2025-07', end: '2025-12' })
  // No frozen refDate: fall back to the last complete month relative to now.
  assert.deepEqual(visitsWindow(null, new Date('2026-07-21T12:00:00Z')), {
    start: '2025-12',
    end: '2026-05',
  })
})

test('traffic: the raw is the mean of the LAST 3 AVAILABLE months, gaps skipped', () => {
  const { avg, used } = averageLastMonths(SIX_MONTHS)
  assert.equal(avg, 3000) // (2000+3000+4000)/3
  assert.deepEqual(used.map((m) => m.date), ['2026-03-01', '2026-04-01', '2026-05-01'])

  // A missing month in the middle: the 3 most recent AVAILABLE months count.
  const gappy = SIX_MONTHS.filter((m) => m.date !== '2026-04-01')
  const g = averageLastMonths(gappy)
  assert.deepEqual(g.used.map((m) => m.date), ['2026-02-01', '2026-03-01', '2026-05-01'])
  assert.equal(g.avg, 2400) // (1200+2000+4000)/3

  // Fewer than 3 months still measures; zero months does not.
  assert.equal(averageLastMonths([SIX_MONTHS[0]]).avg, 1000)
  assert.equal(averageLastMonths([]).avg, null)
})

test('traffic: the trend needs both full quarters, else null', () => {
  assert.equal(trendPct(SIX_MONTHS), 172.7) // 3000 vs 1100
  assert.equal(trendPct(SIX_MONTHS.slice(1)), null) // only 5 months
})

test('traffic: measures the set and keeps the raw as visits, not a log', async () => {
  process.env.SIMILARWEB_API_KEY = 'test-key'
  await withFetch(
    similarwebVisits({ 'client.com': SIX_MONTHS, 'comp1.com': [{ date: '2026-05-01', visits: 900 }] }),
    async () => {
      const out = await trafficWorker(ctx({ driverKey: 'traffic' }))
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      const client = out.sites.find((s) => s.site_ref === 'client')
      assert.equal(client?.raw, 3000) // grezzo: visite, mai log10
      const ev = client?.evidence as {
        visits_avg_3m: number
        months_used: Array<{ date: string }>
        endpoint: string
        trend_3m_vs_prev_3m_pct: number
      }
      assert.equal(ev.visits_avg_3m, 3000)
      assert.equal(ev.months_used.length, 3)
      assert.match(ev.endpoint, /similarweb/)
      assert.equal(ev.trend_3m_vs_prev_3m_pct, 172.7)
      assert.equal(out.sites.find((s) => s.site_ref === 'competitor_1')?.raw, 900)
      assert.equal((out.rawPayload as { trend_client_pct: number }).trend_client_pct, 172.7)
    },
  )
})

test('traffic: a client below coverage is an error, never a zero', async () => {
  process.env.SIMILARWEB_API_KEY = 'test-key'
  await withFetch(
    similarwebVisits({ 'client.com': 404, 'comp1.com': SIX_MONTHS }),
    async () => {
      const out = await trafficWorker(ctx({ driverKey: 'traffic' }))
      assert.equal(out.status, 'error')
      if (out.status !== 'error') return
      assert.match(out.error, /cliente/)
      assert.match(out.error, /coverage/)
    },
  )
})

test('traffic: a competitor below coverage alerts and the analysis continues', async () => {
  process.env.SIMILARWEB_API_KEY = 'test-key'
  await withFetch(
    similarwebVisits({ 'client.com': SIX_MONTHS, 'comp1.com': 404 }),
    async () => {
      const out = await trafficWorker(ctx({ driverKey: 'traffic' }))
      // Sheet 17 "Traffic fallback": alert + continue, softer than a block.
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.deepEqual(out.sites.map((s) => s.site_ref), ['client'])
      const payload = out.rawPayload as {
        coverage_alerts: Array<{ domain: string; reason: string }>
        coverage_note: string
        unmeasured: string[]
      }
      assert.equal(payload.coverage_alerts.length, 1)
      assert.equal(payload.coverage_alerts[0].domain, 'comp1.com')
      assert.match(payload.coverage_note, /rivedi la lista competitor/)
      assert.deepEqual(payload.unmeasured, ['comp1.com'])
    },
  )
})

test('traffic: an empty visits series counts as below coverage, not as zero traffic', async () => {
  process.env.SIMILARWEB_API_KEY = 'test-key'
  await withFetch(
    similarwebVisits({ 'client.com': SIX_MONTHS, 'comp1.com': [] }),
    async () => {
      const out = await trafficWorker(ctx({ driverKey: 'traffic' }))
      assert.equal(out.status, 'done')
      if (out.status !== 'done') return
      assert.deepEqual(out.sites.map((s) => s.site_ref), ['client'])
      assert.equal((out.rawPayload as { coverage_alerts: unknown[] }).coverage_alerts.length, 1)
    },
  )
})

test('traffic: a missing SIMILARWEB_API_KEY is an explicit error before any call', async () => {
  delete process.env.SIMILARWEB_API_KEY
  let fetched = false
  await withFetch(
    () => {
      fetched = true
      return { body: {} }
    },
    async () => {
      const out = await trafficWorker(ctx({ driverKey: 'traffic' }))
      assert.equal(fetched, false)
      assert.equal(out.status, 'error')
      if (out.status !== 'error') return
      assert.match(out.error, /SIMILARWEB_API_KEY/)
    },
  )
})

test('traffic: a missing country is an explicit error — Similarweb rejects "ww"', async () => {
  process.env.SIMILARWEB_API_KEY = 'test-key'
  const out = await trafficWorker(ctx({ driverKey: 'traffic', country: null }))
  assert.equal(out.status, 'error')
  if (out.status !== 'error') return
  assert.match(out.error, /country/)
  assert.match(out.error, /ww/)
})
