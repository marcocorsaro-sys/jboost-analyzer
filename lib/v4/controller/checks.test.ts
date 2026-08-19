/**
 * V4 Controller — checks engine tests.
 * Run: npx tsx --test lib/v4/controller/checks.test.ts
 *
 * The first fixture is the live incident that motivated the module: Speed
 * measured zara.it after the competitor had been replaced with zara.com,
 * and no worker could notice on its own.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countFindings,
  runControllerChecks,
  type ControllerFinding,
  type ControllerInput,
  type ControllerRun,
} from './checks'

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-19T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()
const hoursAgo = (h: number) => minutesAgo(h * 60)

function makeRun(overrides: Partial<ControllerRun> = {}): ControllerRun {
  return {
    driver_key: 'speed',
    enabled: true,
    status: 'done',
    score_absolute: null,
    score_relative: null,
    raw_payload: {},
    llm_insight: null,
    decision_request: null,
    error: null,
    attempts: 1,
    max_attempts: 3,
    created_at: hoursAgo(2),
    dispatched_at: hoursAgo(2),
    started_at: hoursAgo(2),
    lease_expires_at: null,
    ...overrides,
  }
}

function makeInput(overrides: Partial<ControllerInput> = {}): ControllerInput {
  return {
    analysis: {
      id: 'a-1',
      domain: 'benetton.com',
      ref_date: '2026-07-31',
      v4_insights_status: null,
      v4_insights_error: null,
      created_at: hoursAgo(48),
    },
    sites: [
      { site_ref: 'client', domain: 'benetton.com', name: 'Benetton', is_client: true },
      { site_ref: 'competitor_1', domain: 'zara.com', name: 'Zara', is_client: false },
    ],
    runs: [],
    templates: [],
    edits: { draftCount: 0, oldestDraftAt: null },
    now: NOW,
    ...overrides,
  }
}

const byCheck = (findings: ControllerFinding[], check: string) =>
  findings.filter((f) => f.check === check)

// ---------------------------------------------------------------------------
// domain_coherence — the zara.it case
// ---------------------------------------------------------------------------

test('domain_coherence: evidence measured on zara.it after the swap to zara.com is an error', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'speed',
          status: 'done',
          raw_payload: {
            sites: [
              {
                site_ref: 'client',
                domain: 'benetton.com',
                raw: 85,
                evidence: { pages: [{ url: 'https://www.benetton.com/it/', score: 85 }] },
              },
              {
                // The stale measurement: the payload still carries the OLD
                // competitor, replaced in setup by zara.com.
                site_ref: 'competitor_1',
                domain: 'zara.it',
                raw: 70,
                evidence: { pages: [{ url: 'https://www.zara.it/it/donna.html', score: 70 }] },
              },
            ],
          },
        }),
      ],
    }),
  )
  const hits = byCheck(findings, 'domain_coherence')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'error')
  assert.equal(hits[0].driver_key, 'speed')
  assert.match(hits[0].message, /zara\.it/)
  assert.match(hits[0].message, /benetton\.com, zara\.com/) // the current set, spelled out
})

test('domain_coherence: subdomains of a set domain are tolerated (it.benetton.com)', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          raw_payload: {
            sites: [
              {
                site_ref: 'client',
                domain: 'benetton.com',
                raw: 80,
                evidence: {
                  pages: [{ url: 'https://it.benetton.com/donna' }],
                  top_kw: [{ kw: 'benetton', url: 'https://www.benetton.com/' }],
                },
              },
            ],
          },
        }),
      ],
    }),
  )
  assert.deepEqual(byCheck(findings, 'domain_coherence'), [])
})

test('domain_coherence: URLs are scanned recursively, wherever the evidence buries them', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'awareness',
          raw_payload: {
            sites: [
              {
                site_ref: 'competitor_1',
                domain: 'zara.com',
                raw: 10,
                evidence: {
                  nested: { deeper: [{ top_kw: [{ url: 'https://shein.com/sale' }] }] },
                },
              },
            ],
          },
        }),
      ],
    }),
  )
  const hits = byCheck(findings, 'domain_coherence')
  assert.equal(hits.length, 1)
  assert.match(hits[0].message, /shein\.com/)
})

// ---------------------------------------------------------------------------
// template_coherence
// ---------------------------------------------------------------------------

test('template_coherence: a template URL on the wrong domain is an error', () => {
  const findings = runControllerChecks(
    makeInput({
      templates: [
        // competitor_1 is zara.com in the set, but the URL points at zara.it.
        { site_ref: 'competitor_1', template_key: 'pdp', url: 'https://www.zara.it/prodotto' },
        { site_ref: 'client', template_key: 'pdp', url: 'https://www.benetton.com/prodotto' },
      ],
    }),
  )
  const hits = byCheck(findings, 'template_coherence')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'error')
  assert.match(hits[0].message, /zara\.it/)
  assert.match(hits[0].message, /zara\.com/)
})

test('template_coherence: null URLs ("template absent on this site") are not findings', () => {
  const findings = runControllerChecks(
    makeInput({
      templates: [{ site_ref: 'competitor_1', template_key: 'plp', url: null }],
    }),
  )
  assert.deepEqual(byCheck(findings, 'template_coherence'), [])
})

// ---------------------------------------------------------------------------
// zero_with_no_evidence / set_coverage
// ---------------------------------------------------------------------------

test('zero_with_no_evidence: raw 0 without evidence on a done driver is a warning', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'awareness',
          raw_payload: {
            sites: [
              { site_ref: 'client', domain: 'benetton.com', raw: 0, evidence: {} },
              {
                site_ref: 'competitor_1',
                domain: 'zara.com',
                raw: 0,
                // A zero WITH evidence is a documented zero: no finding.
                evidence: { kw_count: 0, method: 'domain-grounded' },
              },
            ],
          },
        }),
      ],
    }),
  )
  const hits = byCheck(findings, 'zero_with_no_evidence')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warning')
  assert.match(hits[0].message, /benetton\.com/)
  assert.doesNotMatch(hits[0].message, /zara\.com/)
})

test('set_coverage: a done driver that skipped a set site names it', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'traffic',
          raw_payload: {
            sites: [{ site_ref: 'client', domain: 'benetton.com', raw: 120000 }],
          },
        }),
      ],
    }),
  )
  const hits = byCheck(findings, 'set_coverage')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warning')
  assert.match(hits[0].message, /zara\.com/)
})

// ---------------------------------------------------------------------------
// stuck_job
// ---------------------------------------------------------------------------

test('stuck_job: a re-queued driver idle for more than 30 minutes is a warning', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'authority',
          status: 'queued',
          attempts: 2,
          dispatched_at: null, // requeue resets it — the check must survive that
          started_at: minutesAgo(45),
          created_at: hoursAgo(3),
        }),
        // Fresh queued job: no finding.
        makeRun({ driver_key: 'schema', status: 'queued', attempts: 1, started_at: minutesAgo(5) }),
      ],
    }),
  )
  const hits = byCheck(findings, 'stuck_job')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].driver_key, 'authority')
  assert.equal(hits[0].severity, 'warning')
})

test('stuck_job: running with a lease expired for more than 10 minutes is a warning', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({ driver_key: 'compliance', status: 'running', lease_expires_at: minutesAgo(15) }),
        // Lease still valid: no finding.
        makeRun({
          driver_key: 'content',
          status: 'running',
          lease_expires_at: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
        }),
      ],
    }),
  )
  const hits = byCheck(findings, 'stuck_job')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].driver_key, 'compliance')
  assert.match(hits[0].message, /lease/)
})

test('stuck_job: a needs_decision open beyond 24h is only an info — the analyst decides', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'discoverability',
          status: 'needs_decision',
          started_at: hoursAgo(30),
          dispatched_at: hoursAgo(30),
          created_at: hoursAgo(30),
          decision_request: { tier: 'strict' },
        }),
      ],
    }),
  )
  const hits = byCheck(findings, 'stuck_job')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'info')
  assert.match(hits[0].message, /analista/)
})

// ---------------------------------------------------------------------------
// attempts_exhausted / score_range
// ---------------------------------------------------------------------------

test('attempts_exhausted: error with attempts >= max_attempts suggests Rilancia', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'traffic',
          status: 'error',
          attempts: 3,
          max_attempts: 3,
          error: 'similarweb 429',
        }),
      ],
    }),
  )
  const hits = byCheck(findings, 'attempts_exhausted')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'error')
  assert.match(hits[0].message, /3\/3/)
  assert.match(hits[0].message, /similarweb 429/)
  assert.match(hits[0].suggestion ?? '', /Rilancia/)
})

test('score_range: out-of-range scores and scores on non-done rows are errors', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({ driver_key: 'speed', status: 'done', score_absolute: 130 }),
        // Leftover score from a previous run on a row now in error.
        makeRun({ driver_key: 'schema', status: 'error', score_relative: 88 }),
        // Healthy done row: no finding.
        makeRun({ driver_key: 'authority', status: 'done', score_absolute: 55, score_relative: 100 }),
      ],
    }),
  )
  const hits = byCheck(findings, 'score_range')
  assert.equal(hits.length, 2)
  assert.ok(hits.every((h) => h.severity === 'error'))
  assert.match(hits.find((h) => h.driver_key === 'speed')!.message, /130/)
  assert.match(hits.find((h) => h.driver_key === 'schema')!.message, /"error"/)
})

// ---------------------------------------------------------------------------
// leader_sanity
// ---------------------------------------------------------------------------

test('leader_sanity: with >=2 measured sites the best score_relative must be 100', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'awareness',
          raw_payload: {
            sites: [
              { site_ref: 'client', domain: 'benetton.com', raw: 500, score_relative: 62 },
              { site_ref: 'competitor_1', domain: 'zara.com', raw: 800, score_relative: 91 },
            ],
          },
        }),
      ],
    }),
  )
  const hits = byCheck(findings, 'leader_sanity')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warning')
  assert.match(hits[0].message, /91/)
})

test('leader_sanity: 100 within +-0.1 passes; a negative raw is flagged', () => {
  const clean = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'awareness',
          raw_payload: {
            sites: [
              { site_ref: 'client', domain: 'benetton.com', raw: 500, score_relative: 62.5 },
              { site_ref: 'competitor_1', domain: 'zara.com', raw: 800, score_relative: 99.95 },
            ],
          },
        }),
      ],
    }),
  )
  assert.deepEqual(byCheck(clean, 'leader_sanity'), [])

  const negative = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'traffic',
          raw_payload: {
            sites: [{ site_ref: 'client', domain: 'benetton.com', raw: -12 }],
          },
        }),
      ],
    }),
  )
  const hits = byCheck(negative, 'leader_sanity')
  assert.equal(hits.length, 1)
  assert.match(hits[0].message, /-12/)
})

// ---------------------------------------------------------------------------
// insight_flags / stale_drafts / insights_error
// ---------------------------------------------------------------------------

test('insight_flags: hallucination flags are a warning listing the numbers; an LLM error is info', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'speed',
          llm_insight: { status: 'done', hallucination_flags: ['99123', '42'] },
        }),
        makeRun({
          driver_key: 'schema',
          llm_insight: { status: 'error', error: 'anthropic overloaded' },
        }),
      ],
    }),
  )
  const hits = byCheck(findings, 'insight_flags')
  assert.equal(hits.length, 2)
  const flagged = hits.find((h) => h.driver_key === 'speed')!
  assert.equal(flagged.severity, 'warning')
  assert.match(flagged.message, /99123, 42/)
  const errored = hits.find((h) => h.driver_key === 'schema')!
  assert.equal(errored.severity, 'info')
  assert.match(errored.message, /anthropic overloaded/)
})

test('stale_drafts: drafts older than 24h are an info with count and age', () => {
  const findings = runControllerChecks(
    makeInput({
      edits: { draftCount: 3, oldestDraftAt: hoursAgo(30) },
    }),
  )
  const hits = byCheck(findings, 'stale_drafts')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'info')
  assert.match(hits[0].message, /3 modifiche/)

  // Fresh drafts: not stale, no noise.
  const fresh = runControllerChecks(
    makeInput({ edits: { draftCount: 2, oldestDraftAt: hoursAgo(1) } }),
  )
  assert.deepEqual(byCheck(fresh, 'stale_drafts'), [])
})

test('insights_error: a failed insights orchestration surfaces with its reason', () => {
  const findings = runControllerChecks(
    makeInput({
      analysis: {
        id: 'a-1',
        domain: 'benetton.com',
        ref_date: '2026-07-31',
        v4_insights_status: 'error',
        v4_insights_error: 'budget exceeded at driver 4',
        created_at: hoursAgo(48),
      },
    }),
  )
  const hits = byCheck(findings, 'insights_error')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warning')
  assert.match(hits[0].message, /budget exceeded at driver 4/)
})

// ---------------------------------------------------------------------------
// clean audit + ordering + counts
// ---------------------------------------------------------------------------

test('a clean audit produces zero findings', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({
          driver_key: 'speed',
          status: 'done',
          score_absolute: 85,
          score_relative: 100,
          llm_insight: { status: 'done', output: {}, hallucination_flags: [] },
          raw_payload: {
            sites: [
              {
                site_ref: 'client',
                domain: 'benetton.com',
                raw: 85,
                score_relative: 100,
                evidence: { pages: [{ url: 'https://www.benetton.com/it/' }] },
              },
              {
                site_ref: 'competitor_1',
                domain: 'zara.com',
                raw: 70,
                score_relative: 82.4,
                evidence: { pages: [{ url: 'https://www.zara.com/it/' }] },
              },
            ],
          },
        }),
      ],
      templates: [
        { site_ref: 'client', template_key: 'home', url: 'https://www.benetton.com/' },
        { site_ref: 'competitor_1', template_key: 'home', url: 'https://www.zara.com/' },
      ],
      edits: { draftCount: 1, oldestDraftAt: hoursAgo(2) },
    }),
  )
  assert.deepEqual(findings, [])
  assert.deepEqual(countFindings(findings), { error: 0, warning: 0, info: 0 })
})

test('ordering: errors first, then warnings, then infos; ties broken by driver uiOrder', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        // warning on speed (uiOrder 7)
        makeRun({
          driver_key: 'speed',
          raw_payload: { sites: [{ site_ref: 'client', domain: 'benetton.com', raw: 0 }] },
        }),
        // warning on awareness (uiOrder 1) — must come before speed's
        makeRun({
          driver_key: 'awareness',
          raw_payload: { sites: [{ site_ref: 'client', domain: 'benetton.com', raw: 0 }] },
        }),
        // error on traffic (uiOrder 4) — must come first overall
        makeRun({ driver_key: 'traffic', status: 'error', attempts: 3, max_attempts: 3 }),
      ],
      edits: { draftCount: 1, oldestDraftAt: hoursAgo(30) }, // info, last
    }),
  )
  assert.deepEqual(
    findings.map((f) => `${f.severity}:${f.check}`),
    [
      'error:attempts_exhausted',
      'warning:zero_with_no_evidence', // awareness (uiOrder 1)
      'warning:set_coverage', //           awareness
      'warning:zero_with_no_evidence', // speed (uiOrder 7)
      'warning:set_coverage', //           speed
      'info:stale_drafts',
    ],
  )
  // Severity blocks are contiguous and driver order is respected inside them.
  const severities = findings.map((f) => f.severity)
  assert.deepEqual(severities, [...severities].sort((a, b) => {
    const rank = { error: 0, warning: 1, info: 2 } as const
    return rank[a] - rank[b]
  }))
  const warningDrivers = findings.filter((f) => f.severity === 'warning').map((f) => f.driver_key)
  assert.deepEqual(warningDrivers, ['awareness', 'awareness', 'speed', 'speed'])
})

test('counts: countFindings splits by severity', () => {
  const findings = runControllerChecks(
    makeInput({
      runs: [
        makeRun({ driver_key: 'traffic', status: 'error', attempts: 3, max_attempts: 3 }),
        makeRun({
          driver_key: 'awareness',
          raw_payload: { sites: [{ site_ref: 'client', domain: 'benetton.com', raw: 0 }] },
        }),
      ],
      edits: { draftCount: 1, oldestDraftAt: hoursAgo(48) },
    }),
  )
  const counts = countFindings(findings)
  assert.equal(counts.error, 1)
  assert.equal(counts.warning, 2) // zero_with_no_evidence + set_coverage
  assert.equal(counts.info, 1)
})
