/**
 * V4 — retry selection tests.
 * Run: npx tsx --test lib/v4/retry.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectRetryDrivers } from './retry'

const run = (driver_key: string, status: string, enabled = true) => ({ driver_key, status, enabled })

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
