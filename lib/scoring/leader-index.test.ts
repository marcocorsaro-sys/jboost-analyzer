/**
 * Tests for the V4 leader-index scoring core.
 *
 * The numeric fixtures are the WORKED EXAMPLES of the Drivers Bibbia (03),
 * sheet 8 "Normalization Model", sections C-F. The expected values must
 * match the sheet EXACTLY — they are the acceptance contract of the
 * scoring module.
 *
 * Run: npx tsx --test lib/scoring/leader-index.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { leaderIndex, scoreSet, round1, gapVsLeaderPct } from './leader-index'
import {
  V4_DRIVERS, V4_LOG_DRIVERS, V4_BUSINESS_DRIVERS, V4_DEVELOPMENT_DRIVERS,
  driversInUiOrder, driversInLlmOrder, fromV1Key, getV4Driver,
} from './registry'

// ---------------------------------------------------------------------------
// Example A — linear (Discoverability, raw = no-brand keyword count)
// Sheet 8: leader 1,500 -> scores 100.0 / 73.3 / 47.2 / 28.0 / 16.0
// ---------------------------------------------------------------------------
test('sheet 8 example A — linear Discoverability', () => {
  const scores = leaderIndex([1500, 1100, 708, 420, 240], 'linear')
  assert.deepEqual(scores, [100.0, 73.3, 47.2, 28.0, 16.0])
})

// ---------------------------------------------------------------------------
// Example B — logarithmic (Traffic, raw = mean monthly visits)
// Sheet 8: leader 300,000 -> log scores 100.0 / 96.8 / 92.7 / 89.5 / 85.8
// (linear reference for the client would be 40.0)
// ---------------------------------------------------------------------------
test('sheet 8 example B — logarithmic Traffic', () => {
  const log = leaderIndex([300_000, 200_000, 120_000, 80_000, 50_000], 'logarithmic')
  assert.deepEqual(log, [100.0, 96.8, 92.7, 89.5, 85.8])

  const linear = leaderIndex([300_000, 200_000, 120_000, 80_000, 50_000], 'linear')
  assert.equal(linear[2], 40.0) // "Linear would put the client at 40.0"
})

// ---------------------------------------------------------------------------
// Example C — intrinsic 0-100 re-normalized (Authority, raw = DR)
// Sheet 8: leader DR 70 -> 100.0 / 88.6 / 78.6 / 58.6 / 54.3
// ---------------------------------------------------------------------------
test('sheet 8 example C — Authority DR re-normalized on leader', () => {
  const scores = leaderIndex([70, 62, 55, 41, 38], 'linear')
  assert.deepEqual(scores, [100.0, 88.6, 78.6, 58.6, 54.3])
})

// ---------------------------------------------------------------------------
// Section D — overall worked example
// (47.2 + 58.6 + 49.0 + 92.7 + 0.5*55.0) / 4.5 = 275.0/4.5 = 61.1
// ---------------------------------------------------------------------------
test('sheet 8 section D — weighted overall = 61.1', () => {
  // Build a single-site set whose leader-index scores are exactly the
  // example's: raw == score with a phantom leader at 100 for each driver.
  const out = scoreSet({
    drivers: ['discoverability', 'authority', 'awareness', 'traffic', 'ai_visibility'],
    weights: { ai_visibility: 0.5 },
    sites: [
      {
        name: 'Leader fantasma', domain: 'leader.example', is_client: false,
        raw: { discoverability: 100, authority: 100, awareness: 100, traffic: 100, ai_visibility: 100 },
      },
      {
        name: 'Cliente', domain: 'client.com', is_client: true,
        raw: { discoverability: 47.2, authority: 58.6, awareness: 49.0, traffic: 92.7, ai_visibility: 55.0 },
      },
    ],
  })
  const client = out.sites.find(s => s.is_client)!
  assert.equal(client.overall, 61.1)
  assert.equal(client.overall_rank, 2)
})

// ---------------------------------------------------------------------------
// Null handling: null = excluded from overall, NOT counted as 0
// ---------------------------------------------------------------------------
test('null raw -> null score, excluded from overall', () => {
  const out = scoreSet({
    drivers: ['authority', 'speed'],
    sites: [
      { name: 'A', domain: 'a.com', is_client: true, raw: { authority: 50, speed: null } },
      { name: 'B', domain: 'b.com', is_client: false, raw: { authority: 100, speed: 80 } },
    ],
  })
  const a = out.sites[0]
  assert.equal(a.scores.speed, null)
  assert.equal(a.rank.speed, null)
  // overall of A = only authority (50.0), not (50+0)/2
  assert.equal(a.overall, 50.0)
})

// ---------------------------------------------------------------------------
// Edge rules (sheet 8 section A)
// ---------------------------------------------------------------------------
test('edge: leader <= 0 -> all scores 0.0', () => {
  assert.deepEqual(leaderIndex([0, -5, 0], 'linear'), [0.0, 0.0, 0.0])
})

test('edge: log with raw<=1 or leader<=1 -> 0.0', () => {
  assert.deepEqual(leaderIndex([1, 0.5], 'logarithmic'), [0.0, 0.0])
  const scores = leaderIndex([1000, 1], 'logarithmic')
  assert.equal(scores[0], 100.0)
  assert.equal(scores[1], 0.0)
})

test('a measured positive value is never 0 (linear)', () => {
  const scores = leaderIndex([1_000_000, 1], 'linear')
  assert.ok(scores[1]! > 0, 'weakest positive must stay above 0')
})

test('degenerate single-site set -> 100 on every driver (sheet 8 section F)', () => {
  const out = scoreSet({
    drivers: ['authority'],
    sites: [{ name: 'Solo', domain: 'solo.com', is_client: true, raw: { authority: 41 } }],
  })
  assert.equal(out.sites[0].scores.authority, 100.0)
})

test('all-null driver -> null leader, null scores', () => {
  const out = scoreSet({
    drivers: ['traffic'],
    log_drivers: ['traffic'],
    sites: [
      { name: 'A', domain: 'a.com', is_client: true, raw: { traffic: null } },
      { name: 'B', domain: 'b.com', is_client: false, raw: { traffic: null } },
    ],
  })
  assert.equal(out.leaders.traffic.leader_domain, null)
  assert.equal(out.sites[0].scores.traffic, null)
  assert.equal(out.sites[0].overall, null)
})

// ---------------------------------------------------------------------------
// Leaders, audit trail, gap chip
// ---------------------------------------------------------------------------
test('leader metadata + audit rows are emitted', () => {
  const out = scoreSet({
    drivers: ['discoverability'],
    sites: [
      { name: 'Cliente', domain: 'client.com', is_client: true, raw: { discoverability: 708 } },
      { name: 'Comp 1', domain: 'comp1.com', is_client: false, raw: { discoverability: 1500 } },
    ],
  })
  assert.equal(out.leaders.discoverability.leader_domain, 'comp1.com')
  assert.equal(out.leaders.discoverability.leader_raw, 1500)
  assert.equal(out.audit.length, 2)
  const clientRow = out.audit.find(r => r.domain === 'client.com')!
  assert.equal(clientRow.raw, 708)
  assert.equal(clientRow.score, 47.2)
  assert.equal(clientRow.rank, 2)
})

test('gap vs leader chip', () => {
  assert.equal(gapVsLeaderPct(47.2), -52.8)
  assert.equal(gapVsLeaderPct(100), 0)
  assert.equal(gapVsLeaderPct(null), null)
})

test('round1 fp safety', () => {
  assert.equal(round1(73.35 - Number.EPSILON), 73.4)
  assert.equal(round1((100 * 708) / 1500), 47.2)
})

// ---------------------------------------------------------------------------
// Registry invariants (README 01 §3 + sheets 7/8)
// ---------------------------------------------------------------------------
test('registry: 10 drivers, 4 business + 6 development', () => {
  assert.equal(V4_DRIVERS.length, 10)
  assert.deepEqual(
    [...V4_BUSINESS_DRIVERS].sort(),
    ['ai_visibility', 'awareness', 'discoverability', 'traffic'].sort(),
  )
  assert.equal(V4_DEVELOPMENT_DRIVERS.length, 6)
})

test('registry: only Traffic is logarithmic', () => {
  assert.deepEqual(V4_LOG_DRIVERS, ['traffic'])
})

test('registry: UI order is Business-first per README §3', () => {
  assert.deepEqual(driversInUiOrder().map(d => d.key), [
    'awareness', 'ai_visibility', 'discoverability', 'traffic',
    'compliance', 'schema', 'speed', 'accessibility', 'content', 'authority',
  ])
})

test('registry: catalog order matches sheets 7/8c (1 Compliance ... 10 Traffic)', () => {
  const byCatalog = [...V4_DRIVERS].sort((a, b) => a.catalogOrder - b.catalogOrder).map(d => d.key)
  assert.deepEqual(byCatalog, [
    'compliance', 'schema', 'speed', 'accessibility', 'content',
    'discoverability', 'ai_visibility', 'authority', 'awareness', 'traffic',
  ])
})

test('registry: LLM sequence matches sheet 16 (AI Visibility excluded)', () => {
  assert.deepEqual(driversInLlmOrder().map(d => d.key), [
    'awareness', 'discoverability', 'traffic', 'authority',
    'compliance', 'content', 'schema', 'speed', 'accessibility',
  ])
  assert.equal(getV4Driver('ai_visibility')!.llmSequence, null)
})

test('registry: absolute view = 6 development + AI Visibility exception', () => {
  const withAbs = V4_DRIVERS.filter(d => d.hasAbsoluteView).map(d => d.key).sort()
  assert.deepEqual(withAbs, [
    'accessibility', 'ai_visibility', 'authority', 'compliance',
    'content', 'schema', 'speed',
  ].sort())
  // relative-only: the 3 Business quantities
  for (const key of ['discoverability', 'awareness', 'traffic']) {
    assert.equal(getV4Driver(key)!.hasAbsoluteView, false, key)
  }
})

test('registry: business drivers are competitor-mandatory, development are not', () => {
  for (const d of V4_DRIVERS) {
    assert.equal(d.competitorMandatory, d.family === 'business', d.key)
  }
})

test('registry: V1 rename mapping (experience->speed, ai_relevance->ai_visibility)', () => {
  assert.equal(fromV1Key('experience')!.key, 'speed')
  assert.equal(fromV1Key('ai_relevance')!.key, 'ai_visibility')
  assert.equal(fromV1Key('aso_visibility'), undefined) // removed from scope
})
