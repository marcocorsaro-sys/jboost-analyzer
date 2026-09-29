/**
 * Tests — lib/v4/semrush-export.ts (Sprint 1, review 2.1 item 4b).
 *
 *   npx tsx --test lib/v4/semrush-export.test.ts
 *
 * Fixtures are minimal on purpose: the two export shapes Semrush actually
 * produces (labelled overview cell, header column), the issues table, the
 * CSV quirks (quotes, ';' delimiter, BOM) and the explicit refusal of an
 * unrecognized format.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsvMatrix,
  parseSemrushCsvText,
  parseSemrushMatrix,
  SEMRUSH_EXPECTED_COLUMNS,
} from './semrush-export'

test('overview shape: labelled "Site Health" cell with value beside it', () => {
  const r = parseSemrushMatrix([
    ['Campaign', 'example.com'],
    ['Site Health', '87%'],
    ['Crawled pages', '1200'],
  ])
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.parsed.site_health, 87)
})

test('overview shape: value under the label (next row, same column)', () => {
  const r = parseSemrushMatrix([
    ['Site Health', 'Errors', 'Warnings'],
    ['92', '14', '230'],
  ])
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.parsed.site_health, 92)
})

test('column shape: "Site Health" header with the value in the data row', () => {
  const r = parseSemrushCsvText('Domain,Site Health,Errors\nexample.com,76.5,120\n')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.parsed.site_health, 76.5)
})

test('issues table is extracted and sorted by pages count', () => {
  const r = parseSemrushMatrix([
    ['Site Health', '80'],
    [],
    ['Issue', 'Type', 'Pages'],
    ['Broken internal links', 'error', '340'],
    ['Duplicate title tags', 'warning', '1200'],
  ])
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.parsed.issues.length, 2)
    assert.equal(r.parsed.issues[0].title, 'Duplicate title tags')
    assert.equal(r.parsed.issues[0].pages_count, 1200)
    assert.equal(r.parsed.issues[1].type, 'error')
  }
})

test('decimal comma and percent sign are normalized', () => {
  const r = parseSemrushCsvText('Site Health;Errors\n"87,4%";12\n')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.parsed.site_health, 87.4)
})

test('unrecognized format fails with the expected columns named', () => {
  const r = parseSemrushCsvText('URL,Status code\nhttps://example.com,200\n')
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.match(r.error, /Site Health/)
    assert.match(r.error, /export Semrush/)
  }
})

test('a value above 100 is not accepted as Site Health', () => {
  const r = parseSemrushMatrix([['Site Health', '870']])
  assert.equal(r.ok, false)
})

test('empty file fails explicitly', () => {
  assert.equal(parseSemrushCsvText('').ok, false)
  assert.equal(parseSemrushMatrix([[]]).ok, false)
})

test('CSV reader: quotes, escaped quotes, BOM and CRLF', () => {
  const rows = parseCsvMatrix('﻿a,b\r\n"x ""q""","y,z"\r\n')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x "q"', 'y,z'],
  ])
})

test('the expected-columns constant mentions Site Health', () => {
  assert.match(SEMRUSH_EXPECTED_COLUMNS, /Site Health/)
})
