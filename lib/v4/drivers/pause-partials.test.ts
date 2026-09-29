/**
 * Sprint 2 — pure tests for the explained pause (item 21) and the explained
 * partials (item 19).
 * Run: npx tsx --test lib/v4/drivers/pause-partials.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildEmptyTierRequest, tierRule } from './discoverability'
import { psiFailureReason } from './pagespeed'
import { readUnmeasuredDetails } from '@/lib/v4/runner/normalize'

// ---------------------------------------------------------------------------
// Item 21 — buildEmptyTierRequest
// ---------------------------------------------------------------------------

test('empty tier: competitor empty offers remove/replace/extend and stays removable', () => {
  const req = buildEmptyTierRequest({
    tier: tierRule('strict'),
    emptyPlayers: ['comp2.com'],
    clientDomain: 'client.com',
    suggestion: 'relaxed_2',
  }) as Record<string, unknown>

  assert.equal(req.reason, 'empty_tier')
  assert.equal(req.empty_client, false)
  assert.deepEqual(req.removable_players, ['comp2.com'])
  assert.deepEqual(req.options, ['remove', 'replace', 'extend'])
  assert.equal(req.next_tier, 'relaxed_2')
  assert.deepEqual(req.tier_rule, { position_max: 10, volume_min: 1000 })
  assert.match(String(req.message), /comp2\.com/)
})

test('empty tier: the CLIENT empty is never removable, only extend is offered', () => {
  const req = buildEmptyTierRequest({
    tier: tierRule('strict'),
    emptyPlayers: ['client.com'],
    clientDomain: 'client.com',
    suggestion: 'relaxed_2',
  }) as Record<string, unknown>

  assert.equal(req.empty_client, true)
  assert.deepEqual(req.removable_players, [])
  assert.deepEqual(req.options, ['extend'])
  assert.match(String(req.message), /CLIENTE/)
})

test('empty tier: client empty at the LAST tier has no options and says so', () => {
  const req = buildEmptyTierRequest({
    tier: tierRule('relaxed_3'),
    emptyPlayers: ['client.com'],
    clientDomain: 'client.com',
    suggestion: null,
  }) as Record<string, unknown>

  assert.deepEqual(req.options, [])
  assert.equal(req.next_tier, null)
  assert.match(String(req.message), /non ci sono tier più larghi/)
})

test('empty tier: client AND competitor empty, only the competitor is removable', () => {
  const req = buildEmptyTierRequest({
    tier: tierRule('strict'),
    emptyPlayers: ['client.com', 'comp1.com'],
    clientDomain: 'client.com',
    suggestion: 'relaxed_2',
  }) as Record<string, unknown>

  assert.equal(req.empty_client, true)
  assert.deepEqual(req.removable_players, ['comp1.com'])
  assert.deepEqual(req.options, ['remove', 'replace', 'extend'])
})

// ---------------------------------------------------------------------------
// Item 19 — psiFailureReason
// ---------------------------------------------------------------------------

test('psiFailureReason: the failure classes name themselves', () => {
  assert.equal(
    psiFailureReason('PageSpeed request failed for https://x (mobile): The operation timed out'),
    'timeout',
  )
  assert.equal(psiFailureReason('PageSpeed returned 429 for https://x (mobile)'), 'quota PSI (429)')
  assert.equal(psiFailureReason('PageSpeed returned 500 for https://x (desktop)'), 'errore PSI 5xx')
  assert.equal(psiFailureReason('PageSpeed returned 404 for https://x (mobile)'), 'richiesta rifiutata (4xx)')
  assert.equal(
    psiFailureReason('PageSpeed per https://x (mobile): budget di tempo esaurito prima della richiesta, il job verrà ritentato'),
    'budget tempo esaurito',
  )
  assert.equal(
    psiFailureReason('PageSpeed returned no lighthouseResult for https://x (mobile)'),
    'risposta Lighthouse incompleta',
  )
})

test('psiFailureReason: an unknown message is clipped, never invented', () => {
  const long = 'x'.repeat(200)
  const reason = psiFailureReason(long)
  assert.ok(reason.length <= 80)
  assert.ok(reason.startsWith('xxx'))
})

// ---------------------------------------------------------------------------
// Item 19 — readUnmeasuredDetails
// ---------------------------------------------------------------------------

test('unmeasured details: coverage alerts win, then per-domain errors, then null', () => {
  const details = readUnmeasuredDetails({
    unmeasured: ['a.com', 'b.com', 'c.com'],
    coverage_alerts: [{ domain: 'a.com', reason: 'sotto coverage Similarweb' }],
    errors: ['b.com: nessun progetto Semrush per il dominio'],
  })
  assert.deepEqual(details, [
    { domain: 'a.com', reason: 'sotto coverage Similarweb' },
    { domain: 'b.com', reason: 'nessun progetto Semrush per il dominio' },
    { domain: 'c.com', reason: null },
  ])
})

test('unmeasured details: empty payloads produce nothing', () => {
  assert.deepEqual(readUnmeasuredDetails(null), [])
  assert.deepEqual(readUnmeasuredDetails({}), [])
  assert.deepEqual(readUnmeasuredDetails({ unmeasured: [] }), [])
})

test('unmeasured details: a domain removed by the analyst says so, not "failed"', () => {
  const details = readUnmeasuredDetails({
    unmeasured: ['comp2.com'],
    removed_by_analyst: ['comp2.com'],
    errors: [],
  })
  assert.match(String(details[0].reason), /rimosso dal set/)
})

test('unmeasured details: a very long reason is clipped', () => {
  const details = readUnmeasuredDetails({
    unmeasured: ['a.com'],
    errors: [`a.com: ${'motivo '.repeat(60)}`],
  })
  assert.ok((details[0].reason as string).length <= 160)
})
