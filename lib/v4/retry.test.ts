/**
 * V4 — retry selection tests.
 * Run: npx tsx --test lib/v4/retry.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectRetryDrivers, selectSingleRetry } from './retry'

const run = (driver_key: string, status: string, enabled = true, edited = false) => ({
  driver_key,
  status,
  enabled,
  edited,
})

test('retry: picks error and stuck-queued drivers only', () => {
  const sel = selectRetryDrivers([
    run('traffic', 'error'),
    run('speed', 'queued'),
    run('schema', 'done'),
    run('content', 'needs_decision'),
    run('authority', 'running'),
  ])
  assert.deepEqual(sel.retry.sort(), ['speed', 'traffic'])
  assert.deepEqual(
    sel.skipped.map((s) => `${s.driver_key}:${s.reason}`).sort(),
    ['authority:running', 'content:needs_decision', 'schema:done'],
  )
})

test('retry: a done driver is never re-run by a blanket retry', () => {
  const sel = selectRetryDrivers([run('schema', 'done')])
  assert.deepEqual(sel.retry, [])
})

test('retry: a paused needs_decision waits for the analyst, not for a retry', () => {
  const sel = selectRetryDrivers([run('ai_visibility', 'needs_decision')])
  assert.deepEqual(sel.retry, [])
})

test('retry: disabled drivers are skipped with their reason', () => {
  const sel = selectRetryDrivers([run('traffic', 'error', false)])
  assert.deepEqual(sel.retry, [])
  assert.deepEqual(sel.skipped, [{ driver_key: 'traffic', reason: 'disabled' }])
})

test('retry: empty set means nothing to do', () => {
  assert.deepEqual(selectRetryDrivers([]), { retry: [], skipped: [] })
})

// ---------------------------------------------------------------------------
// selectSingleRetry — "Rilancia questo driver"
// ---------------------------------------------------------------------------

test('single retry: done without force is refused with 409', () => {
  const d = selectSingleRetry([run('speed', 'done')], 'speed')
  assert.equal(d.ok, false)
  if (!d.ok) {
    assert.equal(d.reason, 'done_needs_force')
    assert.equal(d.httpStatus, 409)
  }
})

test('single retry: done with force re-measures (wipe + requeue)', () => {
  const d = selectSingleRetry([run('speed', 'done')], 'speed', true)
  assert.equal(d.ok, true)
  if (d.ok) {
    assert.equal(d.remeasure, true)
    assert.equal(d.preserveEditedScores, false)
  }
})

test('single retry: an edited done row keeps its scores through the wipe', () => {
  const d = selectSingleRetry([run('authority', 'done', true, true)], 'authority', true)
  assert.equal(d.ok, true)
  if (d.ok) {
    assert.equal(d.remeasure, true)
    assert.equal(d.preserveEditedScores, true)
  }
})

test('single retry: needs_decision is never relaunchable, force or not', () => {
  for (const force of [false, true]) {
    const d = selectSingleRetry([run('discoverability', 'needs_decision')], 'discoverability', force)
    assert.equal(d.ok, false)
    if (!d.ok) {
      assert.equal(d.reason, 'needs_decision')
      assert.equal(d.httpStatus, 409)
    }
  }
})

test('single retry: error is relaunchable without force, no wipe', () => {
  const d = selectSingleRetry([run('traffic', 'error')], 'traffic')
  assert.equal(d.ok, true)
  if (d.ok) {
    assert.equal(d.remeasure, false)
    assert.equal(d.preserveEditedScores, false)
  }
})

test('single retry: a stuck queued row is relaunchable without force', () => {
  const d = selectSingleRetry([run('awareness', 'queued')], 'awareness')
  assert.equal(d.ok, true)
  if (d.ok) assert.equal(d.remeasure, false)
})

test('single retry: running belongs to a live worker — refused', () => {
  const d = selectSingleRetry([run('schema', 'running')], 'schema', true)
  assert.equal(d.ok, false)
  if (!d.ok) assert.equal(d.reason, 'running')
})

test('single retry: disabled driver is refused with a fix-the-setup message', () => {
  const d = selectSingleRetry([run('content', 'error', false)], 'content')
  assert.equal(d.ok, false)
  if (!d.ok) {
    assert.equal(d.reason, 'disabled')
    assert.equal(d.httpStatus, 409)
  }
})

test('single retry: unknown driver is a 404', () => {
  const d = selectSingleRetry([run('speed', 'done')], 'nonexistent')
  assert.equal(d.ok, false)
  if (!d.ok) assert.equal(d.httpStatus, 404)
})
