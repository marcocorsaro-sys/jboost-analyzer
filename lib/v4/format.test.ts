/**
 * Sprint 2 item 17 — pure formatting tests.
 * Run: npx tsx --test lib/v4/format.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  formatEvidenceValue,
  formatInt,
  formatMonth,
  formatMonthsRange,
  formatPct,
  formatPrimitiveList,
} from './format'

test('formatInt: thousands separators per locale, no spurious decimals', () => {
  assert.equal(formatInt(1234567, 'it'), '1.234.567')
  assert.equal(formatInt(1234567, 'en'), '1,234,567')
  assert.equal(formatInt(78950.4, 'it'), '78.950')
  assert.equal(formatInt(999, 'it'), '999')
  assert.equal(formatInt(0, 'it'), '0')
  assert.equal(formatInt(-12500, 'it'), '-12.500')
})

test('formatInt: null/undefined/NaN render as an em-less dash, never 0', () => {
  assert.equal(formatInt(null), '—')
  assert.equal(formatInt(undefined), '—')
  assert.equal(formatInt(Number.NaN), '—')
})

test('formatPct: sign, one decimal max, locale decimal mark', () => {
  assert.equal(formatPct(12.34, 'it'), '+12,3%')
  assert.equal(formatPct(12.34, 'en'), '+12.3%')
  assert.equal(formatPct(-8.06, 'it'), '-8,1%')
  assert.equal(formatPct(12, 'it'), '+12%')
  assert.equal(formatPct(0, 'it'), '0%')
  assert.equal(formatPct(null), '—')
})

test('formatMonth: YYYY-MM(-DD) to short month + year', () => {
  assert.equal(formatMonth('2026-03', 'it'), 'mar 2026')
  assert.equal(formatMonth('2026-03-01', 'en'), 'Mar 2026')
  assert.equal(formatMonth('2026-12', 'it'), 'dic 2026')
  // Unparsable input passes through untouched.
  assert.equal(formatMonth('n/a', 'it'), 'n/a')
})

// ---------------------------------------------------------------------------
// Fix 13/10 — Traffic evidence leggibile ("il valore reale del traffico sono
// le ultime cifre del numero riportato"): la base dei mesi è compatta e i
// valori non si concatenano mai senza separatori.
// ---------------------------------------------------------------------------

test('formatMonthsRange: months_used dates become "lug-ago-set 2026"', () => {
  assert.equal(
    formatMonthsRange(['2026-07-01', '2026-08-01', '2026-09-01'], 'it'),
    'lug-ago-set 2026',
  )
  assert.equal(
    formatMonthsRange(['2026-07-01', '2026-08-01', '2026-09-01'], 'en'),
    'Jul-Aug-Sep 2026',
  )
  // Different years keep their own group.
  assert.equal(
    formatMonthsRange(['2025-11-01', '2025-12-01', '2026-01-01'], 'it'),
    'nov-dic 2025, gen 2026',
  )
  // Unparsable dates pass through, never dropped silently.
  assert.equal(formatMonthsRange(['n/a'], 'it'), 'n/a')
  assert.equal(formatMonthsRange([], 'it'), '')
})

test('formatEvidenceValue: numbers always carry separators, null stays a dash', () => {
  assert.equal(formatEvidenceValue(1182013, 'it'), '1.182.013')
  assert.equal(formatEvidenceValue(78950.4, 'it'), '78.950,4')
  assert.equal(formatEvidenceValue(78950.4, 'en'), '78,950.4')
  assert.equal(formatEvidenceValue(-12.5, 'it'), '-12,5')
  assert.equal(formatEvidenceValue(null, 'it'), '—')
  assert.equal(formatEvidenceValue(undefined, 'it'), '—')
  assert.equal(formatEvidenceValue(Number.NaN, 'it'), '—')
  assert.equal(formatEvidenceValue('similarweb:endpoint', 'it'), 'similarweb:endpoint')
  assert.equal(formatEvidenceValue(true, 'it'), 'true')
})

test('formatPrimitiveList: values are NEVER concatenated without a separator', () => {
  // The exact failure reported by the team: adjacent numbers must never read
  // as one garbled figure whose last digits are the real value.
  const out = formatPrimitiveList([1182013, 1240500, 1300999], 'it')
  assert.equal(out, '1.182.013, 1.240.500, 1.300.999')
  // No run of digits longer than any single value: nothing got glued together.
  assert.ok(!out.includes('0131') && !out.includes('5001'), 'no digit gluing across values')
  // Mixed primitives keep the ", " separator too.
  assert.equal(formatPrimitiveList(['2026-07', 78950.4], 'it'), '2026-07, 78.950,4')
  // Long lists are clipped with an ellipsis, not silently truncated.
  const long = formatPrimitiveList(Array.from({ length: 20 }, (_, i) => i + 100), 'it')
  assert.ok(long.endsWith('…'))
})
