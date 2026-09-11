/**
 * V4 — Ahrefs backlink export parsing tests (review item 5).
 *
 * Run: npx tsx --test lib/v4/backlinks.test.ts
 *
 * Fixtures are built in memory (CSV strings, XLSX via SheetJS write): the
 * point is that a STANDARD Ahrefs export always parses, and a wrong file
 * fails with a message that names what was expected.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'

import { parseBacklinksBuffer, BACKLINK_SAMPLE_ROWS } from './backlinks'

const AHREFS_BACKLINKS_CSV =
  'Referring page URL,Referring page title,Domain rating,URL rating,Anchor,Target URL\n' +
  'https://blog.example.com/post,Un articolo,71,34,client,https://client.com/\n' +
  'https://news.example.org/x,Una notizia,55,12,brand client,https://client.com/p/1\n'

const AHREFS_REFDOMAINS_CSV =
  'Referring domain,Domain rating,Backlinks,Linked domains,First seen\n' +
  'blog.example.com,71,12,340,2024-01-02\n'

test('backlinks: the standard Ahrefs "Backlinks" CSV export parses', () => {
  const result = parseBacklinksBuffer(Buffer.from(AHREFS_BACKLINKS_CSV, 'utf8'))
  assert.ok(result.ok, JSON.stringify(result))
  if (result.ok) {
    assert.equal(result.parsed.row_count, 2)
    assert.ok(result.parsed.columns.includes('Referring page URL'))
    assert.ok(result.parsed.columns.includes('Domain rating'))
    assert.equal(result.parsed.sample.length, 2)
    assert.equal(result.parsed.sample[0]['Referring page URL'], 'https://blog.example.com/post')
  }
})

test('backlinks: the "Referring domains" export variant parses too', () => {
  const result = parseBacklinksBuffer(Buffer.from(AHREFS_REFDOMAINS_CSV, 'utf8'))
  assert.ok(result.ok, JSON.stringify(result))
})

test('backlinks: a UTF-16 CSV with BOM (the Ahrefs "for Excel" default) parses', () => {
  const bom = Buffer.from([0xff, 0xfe])
  const body = Buffer.from(AHREFS_BACKLINKS_CSV, 'utf16le')
  const result = parseBacklinksBuffer(Buffer.concat([bom, body]))
  assert.ok(result.ok, JSON.stringify(result))
  if (result.ok) assert.equal(result.parsed.row_count, 2)
})

test('backlinks: an XLSX export parses', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Referring page URL', 'Domain rating', 'Anchor'],
    ['https://blog.example.com/post', 71, 'client'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Export')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const result = parseBacklinksBuffer(buffer)
  assert.ok(result.ok, JSON.stringify(result))
  if (result.ok) assert.equal(result.parsed.row_count, 1)
})

test('backlinks: unrecognized columns fail with the expected-columns message', () => {
  const result = parseBacklinksBuffer(Buffer.from('nome,valore\na,1\n', 'utf8'))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.error, /colonne non riconosciute/)
    assert.match(result.error, /Referring page URL/)
  }
})

test('backlinks: an empty file and a header-only file fail explicitly', () => {
  const empty = parseBacklinksBuffer(Buffer.from('', 'utf8'))
  assert.equal(empty.ok, false)

  const headerOnly = parseBacklinksBuffer(
    Buffer.from('Referring page URL,Domain rating\n', 'utf8'),
  )
  assert.equal(headerOnly.ok, false)
  if (!headerOnly.ok) assert.match(headerOnly.error, /nessuna riga dati/)
})

test('backlinks: the stored sample is bounded, the row count is not', () => {
  const rows = Array.from(
    { length: BACKLINK_SAMPLE_ROWS + 50 },
    (_, i) => `https://site${i}.com/x,${40 + (i % 30)}`,
  )
  const csv = `Referring page URL,Domain rating\n${rows.join('\n')}\n`
  const result = parseBacklinksBuffer(Buffer.from(csv, 'utf8'))
  assert.ok(result.ok)
  if (result.ok) {
    assert.equal(result.parsed.row_count, BACKLINK_SAMPLE_ROWS + 50)
    assert.equal(result.parsed.sample.length, BACKLINK_SAMPLE_ROWS)
  }
})
