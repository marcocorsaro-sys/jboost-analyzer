/**
 * Sprint 2 item 17 — pure formatting tests.
 * Run: npx tsx --test lib/v4/format.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatInt, formatMonth, formatPct } from './format'

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
