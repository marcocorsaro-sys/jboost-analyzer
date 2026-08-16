/**
 * V4 Block 6 — editability tests.
 *
 * Run: npx tsx --test lib/v4/edits.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validateEdit, validateEdits, EDITABLE_FIELDS } from './edits'
import { normalizeAnalysis } from './runner/normalize'
import type { DriverRunRow } from './runner/types'

test('edits: the raw is not editable — it is the measurement, not a judgement', () => {
  const { patch, error } = validateEdit('raw_value', 42)
  assert.equal(patch, null)
  assert.match(String(error), /non modificabile/)
  assert.match(String(error), /rilancia il driver/)
})

test('edits: only scores and comments are editable', () => {
  assert.deepEqual([...EDITABLE_FIELDS], [
    'score_relative',
    'score_absolute',
    'comment_relative',
    'comment_absolute',
  ])
  for (const field of ['status', 'attempts', 'tier_used', 'edited', 'error']) {
    assert.ok(validateEdit(field, 'x').error, `${field} must not be editable`)
  }
})

test('edits: a score outside 0-100 is rejected', () => {
  assert.ok(validateEdit('score_relative', 101).error)
  assert.ok(validateEdit('score_relative', -1).error)
  assert.ok(validateEdit('score_absolute', 'abc').error)
})

test('edits: scores are rounded to what the columns can store', () => {
  // score_relative is NUMERIC(4,1), score_absolute INTEGER.
  assert.equal(validateEdit('score_relative', 66.666).patch?.value, 66.7)
  assert.equal(validateEdit('score_absolute', 66.6).patch?.value, 67)
})

test('edits: clearing a score is legitimate and becomes null, not 0', () => {
  assert.equal(validateEdit('score_relative', '').patch?.value, null)
  assert.equal(validateEdit('score_absolute', null).patch?.value, null)
})

test('edits: a batch reports every problem, not just the first', () => {
  const { patches, errors } = validateEdits({
    score_relative: 200,
    raw_value: 10,
    comment_relative: 'ok',
  })
  assert.equal(errors.length, 2)
  assert.deepEqual(patches.map((p) => p.field), ['comment_relative'])
})

test('edits: an empty patch is an error, not a silent no-op', () => {
  assert.ok(validateEdits({}).errors.length > 0)
})

test('edits: a recompute never overwrites an edited score', () => {
  const row = (over: Partial<DriverRunRow>): DriverRunRow => ({
    id: 'r1',
    analysis_id: 'a1',
    driver_key: 'authority',
    enabled: true,
    config: {},
    status: 'done',
    raw_value: null,
    score_absolute: null,
    score_relative: null,
    comment_absolute: null,
    comment_relative: null,
    tier_used: null,
    raw_payload: {
      sites: [
        { site_ref: 'client', domain: 'client.com', raw: 60 },
        { site_ref: 'competitor_1', domain: 'c1.com', raw: 80 },
      ],
    },
    decision_request: null,
    decision_taken: null,
    error: null,
    edited: false,
    attempts: 1,
    max_attempts: 3,
    started_at: null,
    completed_at: null,
    lease_expires_at: null,
    dispatched_at: null,
    created_at: '2026-07-21T00:00:00.000Z',
    ...over,
  })

  const computed = normalizeAnalysis([row({})])[0]
  assert.ok(typeof computed.score_relative === 'number')

  // Same raws, but the analyst set 42 by hand: the recompute must leave it.
  const edited = normalizeAnalysis([row({ edited: true, score_relative: 42 })])[0]
  assert.equal(edited.score_relative, 42)
  // …and the raw is still the measured one, not the analyst's opinion.
  assert.equal(edited.raw_value, 60)
})

// ---------------------------------------------------------------------------
// Save & Publish — batch re-run selection (lib/v4/publish.ts)
// ---------------------------------------------------------------------------

import { selectRerunDrivers, type RerunRunSlice, type RerunEditSlice } from './publish'

const run = (over: Partial<RerunRunSlice>): RerunRunSlice => ({
  id: 'r-authority',
  driver_key: 'authority',
  enabled: true,
  status: 'done',
  ...over,
})

const draft = (runId: string, field = 'score_relative'): RerunEditSlice => ({
  driver_run_id: runId,
  field,
  published: false,
})

test('publish: only drivers with DRAFT edits are re-run', () => {
  const runs = [
    run({ id: 'r1', driver_key: 'authority' }),
    run({ id: 'r2', driver_key: 'speed' }),
  ]
  const edits: RerunEditSlice[] = [
    draft('r1'),
    { driver_run_id: 'r2', field: 'score_relative', published: true }, // old batch
  ]
  const { rerun, ineligible } = selectRerunDrivers(runs, edits)
  assert.deepEqual(rerun.map((r) => r.driver_key), ['authority'])
  assert.deepEqual(ineligible, [])
})

test('publish: two drafts on the same driver produce ONE re-run (batch, not per edit)', () => {
  const runs = [run({ id: 'r1', driver_key: 'authority' })]
  const edits = [draft('r1', 'score_relative'), draft('r1', 'comment_relative')]
  assert.equal(selectRerunDrivers(runs, edits).rerun.length, 1)
})

test('publish: re-run order is Business-first (registry uiOrder), like the tabs', () => {
  const runs = [
    run({ id: 'r-auth', driver_key: 'authority' }),   // uiOrder 10
    run({ id: 'r-disco', driver_key: 'discoverability' }), // uiOrder 3
    run({ id: 'r-comp', driver_key: 'compliance' }),  // uiOrder 5
  ]
  const edits = [draft('r-auth'), draft('r-disco'), draft('r-comp')]
  assert.deepEqual(
    selectRerunDrivers(runs, edits).rerun.map((r) => r.driver_key),
    ['discoverability', 'compliance', 'authority'],
  )
})

test('publish: a disabled or non-terminal run is reported, never silently re-queued', () => {
  const runs = [
    run({ id: 'r1', driver_key: 'authority', enabled: false }),
    run({ id: 'r2', driver_key: 'speed', status: 'running' }),
    run({ id: 'r3', driver_key: 'schema', status: 'needs_decision' }),
    run({ id: 'r4', driver_key: 'content', status: 'error' }), // error IS rerunnable
  ]
  const edits = [draft('r1'), draft('r2'), draft('r3'), draft('r4')]
  const { rerun, ineligible } = selectRerunDrivers(runs, edits)
  assert.deepEqual(rerun.map((r) => r.driver_key), ['content'])
  assert.deepEqual(
    ineligible.map((i) => i.driver_key).sort(),
    ['authority', 'schema', 'speed'],
  )
})

test('publish: a draft pointing at a run the analysis no longer has is ignored', () => {
  const { rerun, ineligible } = selectRerunDrivers([], [draft('ghost')])
  assert.deepEqual(rerun, [])
  assert.deepEqual(ineligible, [])
})

test('publish: no drafts means nothing re-runs', () => {
  const runs = [run({ id: 'r1' })]
  assert.deepEqual(selectRerunDrivers(runs, []).rerun, [])
})
