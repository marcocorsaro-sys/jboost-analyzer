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
