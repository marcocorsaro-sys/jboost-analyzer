/**
 * V4 Block 2 — runner tests.
 *
 * Run: npx tsx --test lib/v4/runner/runner.test.ts
 *
 * The pure modules (planner, reaper, normalize) are tested directly. The
 * execution glue is tested against a fake Supabase client, because the
 * behaviour that matters there is exactly the behaviour that is easy to get
 * wrong and impossible to see from the outside: what gets written when a
 * worker fails, when it fails for the last time, and when it succeeds.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planDriverRuns, computeRefDate } from './planner'
import { selectStaleRuns, selectUndispatchedRuns } from './reaper'
import { normalizeAnalysis, summarizeProgress } from './normalize'
import { executeDriverJob } from './execute'
import { DRIVER_WORKERS } from './workers'
import type { AnalysisSite, DriverRunRow } from './types'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const SITES: AnalysisSite[] = [
  { site_ref: 'client', domain: 'client.com', name: 'Client', is_client: true },
  { site_ref: 'competitor_1', domain: 'comp1.com', name: 'C1', is_client: false },
  { site_ref: 'competitor_2', domain: 'comp2.com', name: 'C2', is_client: false },
]

function row(overrides: Partial<DriverRunRow> = {}): DriverRunRow {
  return {
    id: 'run-1',
    analysis_id: 'analysis-1',
    driver_key: 'authority',
    enabled: true,
    config: {},
    status: 'running',
    raw_value: null,
    score_absolute: null,
    score_relative: null,
    comment_absolute: null,
    comment_relative: null,
    tier_used: null,
    raw_payload: {},
    decision_request: null,
    decision_taken: null,
    error: null,
    edited: false,
    attempts: 1,
    max_attempts: 3,
    started_at: '2026-07-21T10:00:00.000Z',
    completed_at: null,
    lease_expires_at: '2026-07-21T10:05:00.000Z',
    dispatched_at: '2026-07-21T10:00:00.000Z',
    created_at: '2026-07-21T09:59:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// planner
// ---------------------------------------------------------------------------

test('planner: a Business driver without competitors is a setup error, not a run', () => {
  const { runs, errors } = planDriverRuns({
    enabledDrivers: ['traffic'],
    sites: [SITES[0]],
  })
  assert.equal(runs.length, 0)
  assert.ok(errors.some((e) => e.includes('traffic') && e.includes('competitor')))
})

test('planner: a Development driver runs fine alone', () => {
  const { runs, errors } = planDriverRuns({
    enabledDrivers: ['authority'],
    sites: [SITES[0]],
  })
  assert.deepEqual(errors, [])
  assert.deepEqual(runs.map((r) => r.driver_key), ['authority'])
})

test('planner: unknown driver keys are rejected, never silently dropped', () => {
  const { errors } = planDriverRuns({
    enabledDrivers: ['aso_visibility', 'authority'],
    sites: SITES,
  })
  assert.ok(errors.some((e) => e.includes('aso_visibility')))
})

test('planner: exactly one client, at most four competitors', () => {
  const noClient = planDriverRuns({ enabledDrivers: ['authority'], sites: [SITES[1]] })
  assert.ok(noClient.errors.some((e) => e.includes('exactly one client')))

  const tooMany = planDriverRuns({
    enabledDrivers: ['authority'],
    sites: [
      SITES[0],
      ...Array.from({ length: 5 }, (_, i) => ({
        site_ref: `competitor_${i + 1}` as AnalysisSite['site_ref'],
        domain: `c${i}.com`,
        name: `C${i}`,
        is_client: false,
      })),
    ],
  })
  assert.ok(tooMany.errors.some((e) => e.includes('at most 4 competitors')))
})

test('planner: duplicates collapse and the plan is seeded in UI order', () => {
  const { runs } = planDriverRuns({
    enabledDrivers: ['authority', 'traffic', 'authority'],
    sites: SITES,
  })
  assert.equal(runs.length, 2)
  // Business drivers come first in the UI order (registry).
  assert.equal(runs[0].driver_key, 'traffic')
})

test('computeRefDate: last day of the last COMPLETE month, UTC', () => {
  assert.equal(computeRefDate(new Date('2026-07-21T12:00:00Z')), '2026-06-30')
  assert.equal(computeRefDate(new Date('2026-01-05T00:00:00Z')), '2025-12-31')
  assert.equal(computeRefDate(new Date('2024-03-10T00:00:00Z')), '2024-02-29') // leap year
})

// ---------------------------------------------------------------------------
// reaper
// ---------------------------------------------------------------------------

const NOW = new Date('2026-07-21T10:10:00.000Z')

test('reaper: an expired lease with attempts left goes back in the queue', () => {
  const { requeue, fail } = selectStaleRuns([row()], NOW)
  assert.equal(requeue.length, 1)
  assert.equal(fail.length, 0)
})

test('reaper: an expired lease out of attempts fails with the real reason', () => {
  const { requeue, fail } = selectStaleRuns([row({ attempts: 3, max_attempts: 3 })], NOW)
  assert.equal(requeue.length, 0)
  assert.equal(fail.length, 1)
  assert.match(fail[0].error, /abandoned after 3 attempt/)
})

test('reaper: a live lease is left alone (and the grace period is honoured)', () => {
  const live = row({ lease_expires_at: '2026-07-21T10:15:00.000Z' })
  assert.equal(selectStaleRuns([live], NOW).requeue.length, 0)

  // Expired 10s ago: inside the 30s grace, still not touched.
  const justExpired = row({ lease_expires_at: '2026-07-21T10:09:50.000Z' })
  assert.equal(selectStaleRuns([justExpired], NOW).requeue.length, 0)
})

test('reaper: a running row with no lease falls back to started_at', () => {
  const legacy = row({ lease_expires_at: null })
  assert.equal(selectStaleRuns([legacy], NOW).requeue.length, 1)
})

test('reaper: only running rows are considered', () => {
  const done = row({ status: 'done' })
  const decision = row({ status: 'needs_decision' })
  const out = selectStaleRuns([done, decision], NOW)
  assert.equal(out.requeue.length + out.fail.length, 0)
})

test('reaper: a queued job nobody collected is re-dispatched after the grace period', () => {
  const stale = row({
    status: 'queued',
    attempts: 0,
    lease_expires_at: null,
    dispatched_at: null,
    created_at: '2026-07-21T10:00:00.000Z', // 10 min old
  })
  assert.equal(selectUndispatchedRuns([stale], NOW).length, 1)

  const fresh = { ...stale, created_at: '2026-07-21T10:09:00.000Z' } // 1 min old
  assert.equal(selectUndispatchedRuns([fresh], NOW).length, 0)

  const exhausted = { ...stale, attempts: 3 }
  assert.equal(selectUndispatchedRuns([exhausted], NOW).length, 0)
})

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

function doneRow(driver: string, raws: Array<number | null>): DriverRunRow {
  return row({
    id: `run-${driver}`,
    driver_key: driver as DriverRunRow['driver_key'],
    status: 'done',
    raw_payload: {
      sites: SITES.map((s, i) => ({
        site_ref: s.site_ref,
        domain: s.domain,
        raw: raws[i],
      })),
    },
  })
}

test('normalize: the leader scores 100 and the client is scored against the set', () => {
  // Authority DR: client 60, competitors 80 and 40 -> leader index on 80.
  const updates = normalizeAnalysis([doneRow('authority', [60, 80, 40])])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].raw_value, 60)

  const sites = (updates[0].raw_payload as { sites: Array<{ site_ref: string; score_relative: number | null }> }).sites
  const leader = sites.find((s) => s.site_ref === 'competitor_1')
  assert.equal(leader?.score_relative, 100)
  assert.ok((updates[0].score_relative ?? 0) > 0 && (updates[0].score_relative ?? 0) < 100)
})

test('normalize: a null raw is excluded, never counted as zero', () => {
  const withNull = normalizeAnalysis([doneRow('authority', [60, 80, null])])
  const sites = (withNull[0].raw_payload as { sites: Array<{ site_ref: string; score_relative: number | null }> }).sites
  const missing = sites.find((s) => s.site_ref === 'competitor_2')
  assert.equal(missing?.score_relative, null)

  // The client's score must match the two-site set, i.e. the null site did
  // not drag the floor down to 0.
  const withoutIt = normalizeAnalysis([doneRow('authority', [60, 80, null])])
  assert.equal(withNull[0].score_relative, withoutIt[0].score_relative)
})

test('normalize: an edited row keeps the analyst score but still feeds the set', () => {
  const edited = { ...doneRow('authority', [60, 80, 40]), edited: true, score_relative: 42 }
  const updates = normalizeAnalysis([edited])
  assert.equal(updates[0].score_relative, 42)
})

test('normalize: only done rows participate', () => {
  const queued = row({ status: 'queued' })
  assert.deepEqual(normalizeAnalysis([queued]), [])
})

test('summarizeProgress: complete only when nothing is queued or running', () => {
  const rows = [
    row({ id: 'a', status: 'done' }),
    row({ id: 'b', status: 'error' }),
    row({ id: 'c', status: 'needs_decision' }),
  ]
  const p = summarizeProgress(rows)
  assert.deepEqual(
    { total: p.total, done: p.done, error: p.error, needs_decision: p.needs_decision, pending: p.pending, complete: p.complete },
    { total: 3, done: 1, error: 1, needs_decision: 1, pending: 0, complete: true },
  )

  const stillRunning = summarizeProgress([...rows, row({ id: 'd', status: 'running' })])
  assert.equal(stillRunning.complete, false)

  // A disabled driver is not part of the count.
  const disabled = summarizeProgress([row({ id: 'e', status: 'queued', enabled: false })])
  assert.equal(disabled.total, 0)
  assert.equal(disabled.complete, false)
})

// ---------------------------------------------------------------------------
// execute — the state machine, against a fake Supabase client
// ---------------------------------------------------------------------------

interface FakeState {
  claimed: DriverRunRow | null
  updates: Array<{ id: string; patch: Record<string, unknown> }>
  rows: DriverRunRow[]
}

function fakeDb(state: FakeState) {
  const analysis = {
    id: 'analysis-1',
    domain: 'client.com',
    brand_name: 'Client',
    brand_variants: [],
    competitors: ['https://comp1.com', 'https://www.comp2.com/path'],
    competitor_details: [],
    ref_date: '2026-06-30',
    country: 'IT',
  }

  return {
    rpc: async () => ({ data: state.claimed ? [state.claimed] : [], error: null }),
    from(table: string) {
      if (table === 'analyses') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: analysis, error: null }) }) }),
        }
      }
      if (table === 'template_configs') {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      }
      return {
        select: () => ({
          eq: async () => ({ data: state.rows, error: null }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            state.updates.push({ id, patch })
            return { error: null }
          },
        }),
      }
    },
  } as never
}

test('execute: nothing to claim is not an error', async () => {
  const state: FakeState = { claimed: null, updates: [], rows: [] }
  const result = await executeDriverJob(fakeDb(state), 'analysis-1', 'authority')
  assert.equal(result.claimed, false)
  assert.equal(state.updates.length, 0)
})

test('execute: a worker error with attempts left goes back to queued, not error', async () => {
  const state: FakeState = {
    claimed: row({ status: 'running', attempts: 1, max_attempts: 3 }),
    updates: [],
    rows: [],
  }
  const original = DRIVER_WORKERS.authority
  DRIVER_WORKERS.authority = async () => ({ status: 'error', error: 'API down' })
  try {
    const result = await executeDriverJob(fakeDb(state), 'analysis-1', 'authority')
    assert.equal(result.requeued, true)
    assert.equal(state.updates[0].patch.status, 'queued')
    assert.equal(state.updates[0].patch.error, 'API down')
    // The lease must be released, or the reaper thinks a worker is still alive.
    assert.equal(state.updates[0].patch.lease_expires_at, null)
  } finally {
    DRIVER_WORKERS.authority = original
  }
})

test('execute: the last attempt fails for good, with the real reason', async () => {
  const state: FakeState = {
    claimed: row({ status: 'running', attempts: 3, max_attempts: 3 }),
    updates: [],
    rows: [],
  }
  const original = DRIVER_WORKERS.authority
  DRIVER_WORKERS.authority = async () => ({ status: 'error', error: 'API down' })
  try {
    await executeDriverJob(fakeDb(state), 'analysis-1', 'authority')
    assert.equal(state.updates[0].patch.status, 'error')
    assert.equal(state.updates[0].patch.error, 'API down')
    assert.ok(state.updates[0].patch.completed_at)
  } finally {
    DRIVER_WORKERS.authority = original
  }
})

test('execute: a worker that throws is an error outcome, never a zero', async () => {
  const state: FakeState = {
    claimed: row({ status: 'running', attempts: 3, max_attempts: 3 }),
    updates: [],
    rows: [],
  }
  const original = DRIVER_WORKERS.authority
  DRIVER_WORKERS.authority = async () => {
    throw new Error('boom')
  }
  try {
    await executeDriverJob(fakeDb(state), 'analysis-1', 'authority')
    assert.equal(state.updates[0].patch.status, 'error')
    assert.match(String(state.updates[0].patch.error), /worker threw: boom/)
    assert.equal(state.updates[0].patch.raw_value, undefined)
  } finally {
    DRIVER_WORKERS.authority = original
  }
})

test('execute: a needs_decision pause writes the request and never a score', async () => {
  const state: FakeState = { claimed: row({ status: 'running' }), updates: [], rows: [] }
  const original = DRIVER_WORKERS.discoverability
  DRIVER_WORKERS.discoverability = async () => ({
    status: 'needs_decision',
    decisionRequest: { empty_players: ['comp2.com'], options: ['remove', 'replace', 'extend'] },
  })
  try {
    await executeDriverJob(fakeDb(state), 'analysis-1', 'discoverability')
    const patch = state.updates[0].patch
    assert.equal(patch.status, 'needs_decision')
    assert.deepEqual((patch.decision_request as { options: string[] }).options, [
      'remove',
      'replace',
      'extend',
    ])
    assert.equal(patch.raw_value, undefined)
  } finally {
    DRIVER_WORKERS.discoverability = original
  }
})

test('execute: a successful job stores per-site raws and then normalizes them', async () => {
  const claimed = row({ status: 'running' })
  const state: FakeState = { claimed, updates: [], rows: [] }
  const original = DRIVER_WORKERS.authority
  DRIVER_WORKERS.authority = async (ctx) => {
    // The worker receives the whole set, resolved from the analysis row.
    assert.deepEqual(ctx.sites.map((s) => s.domain), ['client.com', 'comp1.com', 'comp2.com'])
    assert.equal(ctx.refDate, '2026-06-30')
    assert.deepEqual(ctx.templates, [])
    return {
      status: 'done',
      sites: ctx.sites.map((s, i) => ({
        site_ref: s.site_ref,
        domain: s.domain,
        raw: [60, 80, 40][i],
      })),
    }
  }
  try {
    // What the re-normalization pass reads back after the outcome is written.
    state.rows = [doneRow('authority', [60, 80, 40])]

    const result = await executeDriverJob(fakeDb(state), 'analysis-1', 'authority')
    assert.equal(result.status, 'done')

    const outcomePatch = state.updates[0].patch
    assert.equal(outcomePatch.status, 'done')
    assert.equal((outcomePatch.raw_payload as { sites: unknown[] }).sites.length, 3)

    // Second write = the normalization pass filling the derived columns.
    const normalizePatch = state.updates[1].patch
    assert.equal(normalizePatch.raw_value, 60)
    assert.ok(typeof normalizePatch.score_relative === 'number')
    assert.ok((normalizePatch.raw_payload as { normalized_at: string }).normalized_at)
  } finally {
    DRIVER_WORKERS.authority = original
  }
})

test('execute: an unregistered driver key is a loud error, not a skip', async () => {
  const state: FakeState = { claimed: row({ driver_key: 'nope' as never }), updates: [], rows: [] }
  const result = await executeDriverJob(fakeDb(state), 'analysis-1', 'nope')
  assert.equal(result.status, 'error')
  assert.equal(state.updates[0].patch.status, 'error')
})

test('execute: a driver whose credentials are missing refuses explicitly', async () => {
  // Traffic uses Similarweb and nothing else. Without the API key the worker
  // must name the missing credential, so nobody reads the failure as "the
  // site has no traffic".
  delete process.env.SIMILARWEB_API_KEY
  const state: FakeState = {
    claimed: row({ driver_key: 'traffic', attempts: 3, max_attempts: 3 }),
    updates: [],
    rows: [],
  }
  const result = await executeDriverJob(fakeDb(state), 'analysis-1', 'traffic')
  assert.equal(result.status, 'error')
  assert.match(String(result.error), /SIMILARWEB_API_KEY/)
  assert.equal(state.updates[0].patch.raw_value, undefined)
})
