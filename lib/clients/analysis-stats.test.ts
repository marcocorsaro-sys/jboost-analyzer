import test from 'node:test'
import assert from 'node:assert/strict'
import { buildClientStats, summarizeClientAnalyses } from './analysis-stats'

test('V4 audits count for the client even though their analyses.status is never completed', () => {
  const m = buildClientStats(
    [],
    [
      { clientId: 'c1', overallScore: 80, createdAt: '2026-10-20T10:00:00Z', started: true },
      { clientId: 'c1', overallScore: 84, createdAt: '2026-10-23T10:00:00Z', started: true },
      { clientId: 'c1', overallScore: null, createdAt: '2026-10-25T10:00:00Z', started: false }, // draft, never launched
      { clientId: null, overallScore: 50, createdAt: '2026-10-25T10:00:00Z', started: true }, // prospect
    ],
  )
  const s = m.get('c1')!
  assert.equal(s.count, 2)
  assert.equal(s.latest_score, 84)
  assert.equal(s.previous_score, 80)
  assert.equal(m.size, 1)
})

test('V1 completed and V4 are merged by date', () => {
  const m = buildClientStats(
    [{ client_id: 'c1', overall_score: 70, completed_at: '2026-08-01T00:00:00Z' }],
    [{ clientId: 'c1', overallScore: 90, createdAt: '2026-10-01T00:00:00Z', started: true }],
  )
  assert.deepEqual(m.get('c1'), { count: 2, latest_score: 90, previous_score: 70, latest_analysis_at: '2026-10-01T00:00:00Z' })
})

test('empty -> null', () => {
  assert.equal(summarizeClientAnalyses([]), null)
})
