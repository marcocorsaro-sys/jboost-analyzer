/**
 * Sprint 2 item 10 — anti-hallucination number matcher, tolerances.
 * Run: npx tsx --test lib/v4/llm/matcher.test.ts
 *
 * The flag must be SPECIFIC (list exactly the unbacked tokens) and tolerant
 * of legitimate citation styles: thousands separators (en/it), roundings of
 * decimal payload values, percentages citing a decimal as an integer.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { findInventedNumbers } from './orchestrator'

const payload = JSON.stringify({
  visits_avg_3m: 78950.4,
  pages: 12847,
  lcp_s: 4.24,
  share_pct: 12.3,
  score: 62,
})

test('matcher: exact and separator-variant citations pass', () => {
  const out = {
    commento_relative:
      'Su 12,847 pagine il cliente registra 78.950 visite medie; anche 12847 scritto secco passa.',
  }
  assert.deepEqual(findInventedNumbers(out, [payload]), [])
})

test('matcher: integer rounding of a decimal payload value passes (78.950 for 78950.4, 12% for 12.3)', () => {
  const out = {
    commento_relative: 'Circa 78.950 visite al mese e una quota organica del 12%.',
  }
  assert.deepEqual(findInventedNumbers(out, [payload]), [])
})

test('matcher: one-decimal rounding of a finer payload value passes (4.2 for 4.24)', () => {
  const out = { items: [{ spiegazione: 'LCP a 4.2s sul template PDP.' }] }
  assert.deepEqual(findInventedNumbers(out, [payload]), [])
})

test('matcher: unbacked numbers are flagged BY NAME, and only those', () => {
  const out = {
    commento_relative: 'Su 12,847 pagine si stimano 99.123 visite e un gap del 38%.',
  }
  const flags = findInventedNumbers(out, [payload])
  assert.deepEqual(flags.sort(), ['38', '99.123'])
})

test('matcher: when every number matches there is NO warning at all', () => {
  const out = {
    commento_relative: 'Score 62 su 12847 pagine.',
    items: [{ spiegazione: 'LCP 4.24s, quota 12.3%.' }],
  }
  assert.deepEqual(findInventedNumbers(out, [payload]), [])
})

test('matcher: numbers <= 10 are never flagged (priorities, horizons)', () => {
  const out = { commento_relative: 'Priorità 1, orizzonte 3-6 mesi, top 10.' }
  assert.deepEqual(findInventedNumbers(out, [payload]), [])
})
