/**
 * Tests — lib/v4/llm/json-repair.ts (Sprint 1, review 2.1 item 2b).
 *
 * The scenario that matters most is the REAL one from the field: a driver
 * insight truncated mid-array at max_tokens ("position 5099"), which must
 * come back as the completed prefix instead of failing three retries.
 *
 *   npx tsx --test lib/v4/llm/json-repair.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairJson } from './json-repair'

test('clean JSON parses without being marked repaired', () => {
  const r = repairJson('{"a": 1, "b": [1, 2]}')
  assert.deepEqual(r.value, { a: 1, b: [1, 2] })
  assert.equal(r.repaired, false)
  assert.equal(r.error, null)
})

test('JSON wrapped in prose and code fences is extracted', () => {
  const r = repairJson('Ecco il risultato:\n```json\n{"ok": true}\n```\ngrazie')
  assert.deepEqual(r.value, { ok: true })
})

test('trailing garbage after the balanced object is dropped', () => {
  const r = repairJson('{"a": 1} e qualche testo dopo, con { parentesi')
  assert.deepEqual(r.value, { a: 1 })
})

test('truncation inside a string value closes the string and scopes', () => {
  const r = repairJson('{"items": [{"titolo": "Errori 404", "spiegazione": "Il sito ha 12')
  assert.equal(r.repaired, true)
  const items = r.value?.items as Array<Record<string, unknown>>
  assert.equal(items.length, 1)
  // The incomplete "spiegazione" is cut back to the last complete value.
  assert.equal(items[0].titolo, 'Errori 404')
  assert.equal('spiegazione' in items[0], false)
})

test('truncation right after a comma keeps the completed items', () => {
  const r = repairJson('{"items": [{"titolo": "A", "priorita": "alta"}, {"titolo": "B"},')
  assert.equal(r.repaired, true)
  const items = r.value?.items as Array<Record<string, unknown>>
  assert.equal(items.length, 2)
  assert.equal(items[1].titolo, 'B')
})

test('truncation after a key (before its value) drops the dangling key', () => {
  const r = repairJson('{"commento_relative": "Testo completo.", "items": [{"titolo":')
  assert.equal(r.repaired, true)
  assert.equal(r.value?.commento_relative, 'Testo completo.')
})

test('truncation inside a number literal cuts back to the previous value', () => {
  const r = repairJson('{"a": "ok", "b": 12.')
  assert.equal(r.repaired, true)
  assert.deepEqual(r.value, { a: 'ok' })
})

test('complete number followed by truncation survives', () => {
  const r = repairJson('{"score": 42, "items": [')
  assert.equal(r.repaired, true)
  assert.equal(r.value?.score, 42)
  // The just-opened, empty "items" array is dropped with its dangling key:
  // the repair keeps only values that were actually completed.
  assert.equal('items' in (r.value ?? {}), false)
})

test('escaped quotes inside strings do not break the scanner', () => {
  const r = repairJson('{"a": "detto \\"cosi\\"", "b": [1')
  assert.equal(r.repaired, true)
  assert.equal(r.value?.a, 'detto "cosi"')
})

test('truncated boolean literal is not treated as a value', () => {
  const r = repairJson('{"a": 1, "b": tru')
  assert.equal(r.repaired, true)
  assert.deepEqual(r.value, { a: 1 })
})

test('realistic truncated driver insight (the position-5099 case)', () => {
  const long = '{"commento_relative": "Il cliente e secondo nel set.", "items": [' +
    '{"titolo": "Uno", "spiegazione": "Prima spiegazione.", "priorita": "alta"},' +
    '{"titolo": "Due", "spiegazione": "Seconda spiegazione.", "priorita": "media"},' +
    '{"titolo": "Tre", "spiegazione": "Il sito presenta 1.240 pagine con probl'
  const r = repairJson(long)
  assert.equal(r.repaired, true)
  const items = r.value?.items as Array<Record<string, unknown>>
  assert.equal(items.length, 3)
  assert.equal(items[2].titolo, 'Tre')
  assert.equal(r.value?.commento_relative, 'Il cliente e secondo nel set.')
})

test('no JSON at all is a clear refusal', () => {
  const r = repairJson('nessun oggetto qui')
  assert.equal(r.value, null)
  assert.match(r.error ?? '', /no JSON object/)
})

test('unrepairable prefix is a clear refusal, never a throw', () => {
  const r = repairJson('{')
  assert.equal(r.value, null)
  assert.equal(r.repaired, false)
})

test('mismatched closers cut back to the last coherent value', () => {
  const r = repairJson('{"a": [1, 2}, "b": 3')
  // '}' closing a '[' is garbage from there on: keep what was coherent.
  assert.equal(r.repaired, true)
  assert.deepEqual(r.value, { a: [1, 2] })
})
