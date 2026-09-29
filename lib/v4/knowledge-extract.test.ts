/**
 * Sprint 2 item 18 — knowledge document extraction, pure half.
 * Run: npx tsx --test lib/v4/knowledge-extract.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  KNOWLEDGE_EXTRACT_BUDGET,
  decodeTextBuffer,
  knowledgeDocumentsClause,
  knowledgeExtractKind,
  normalizeExtractedText,
  readKnowledgeDocs,
  truncateExtract,
} from './knowledge-extract'

test('knowledgeExtractKind: text/pdf/docx are extractable, the rest is not', () => {
  assert.equal(knowledgeExtractKind('.txt'), 'text')
  assert.equal(knowledgeExtractKind('.md'), 'text')
  assert.equal(knowledgeExtractKind('.csv'), 'text')
  assert.equal(knowledgeExtractKind('.PDF'), 'pdf')
  assert.equal(knowledgeExtractKind('.docx'), 'docx')
  assert.equal(knowledgeExtractKind('.doc'), null)
  assert.equal(knowledgeExtractKind('.pptx'), null)
  assert.equal(knowledgeExtractKind('.xlsx'), null)
  assert.equal(knowledgeExtractKind(''), null)
})

test('decodeTextBuffer: UTF-8 with and without BOM, UTF-16 LE BOM', () => {
  assert.equal(decodeTextBuffer(Buffer.from('ciao è qui', 'utf8')), 'ciao è qui')
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ciao', 'utf8')])
  assert.equal(decodeTextBuffer(bom), 'ciao')
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('brand', 'utf16le')])
  assert.equal(decodeTextBuffer(utf16), 'brand')
})

test('normalizeExtractedText: CRLF, control noise and blank-line runs collapse', () => {
  const raw = 'Titolo\r\n\r\n\r\n\r\nCorpo\u0000 con rumore\t \nfine'
  assert.equal(normalizeExtractedText(raw), 'Titolo\n\nCorpo con rumore\nfine')
})

test('truncateExtract: below budget nothing changes, above budget cut at word boundary', () => {
  const short = truncateExtract('breve testo', 100)
  assert.equal(short.text, 'breve testo')
  assert.equal(short.truncated, false)
  assert.equal(short.chars, 'breve testo'.length)

  const long = truncateExtract(`${'parola '.repeat(50)}finale`, 100)
  assert.equal(long.truncated, true)
  assert.ok(long.text.length <= 100)
  // Cut at a word boundary: never half a word as the last token.
  assert.ok(long.text.endsWith('parola'))
  assert.equal(long.chars, normalizeLen(`${'parola '.repeat(50)}finale`))

  function normalizeLen(t: string): number {
    return t.trim().length
  }
})

test('truncateExtract: default budget is the documented one', () => {
  const big = truncateExtract('x'.repeat(KNOWLEDGE_EXTRACT_BUDGET + 500))
  assert.equal(big.truncated, true)
  assert.ok(big.text.length <= KNOWLEDGE_EXTRACT_BUDGET)
})

test('readKnowledgeDocs: only knowledge_doc kinds, text null when absent', () => {
  const docs = readKnowledgeDocs({
    attachments: [
      { kind: 'knowledge_doc', name: 'brief.pdf', extracted_text: 'contenuto del brief' },
      { kind: 'knowledge_doc', name: 'brand.pptx', extract_error: 'formato non estraibile (.pptx)' },
      { kind: 'authority_backlinks', name: 'links.csv', extracted_text: 'non knowledge' },
      null,
      'junk',
    ],
  })
  assert.equal(docs.length, 2)
  assert.deepEqual(docs[0], { name: 'brief.pdf', text: 'contenuto del brief', truncated: false })
  assert.equal(docs[1].text, null)
})

test('readKnowledgeDocs: no attachments, no docs', () => {
  assert.deepEqual(readKnowledgeDocs(null), [])
  assert.deepEqual(readKnowledgeDocs({}), [])
})

test('knowledgeDocumentsClause: empty without readable docs, instructive with them', () => {
  assert.equal(knowledgeDocumentsClause([]), '')
  assert.equal(knowledgeDocumentsClause([{ name: 'x.pptx', text: null }]), '')

  const clause = knowledgeDocumentsClause([
    { name: 'brief.pdf', text: 'Tone of voice sobrio. Budget 50000 EUR.', truncated: true },
    { name: 'note.txt', text: 'Evitare superlativi.' },
  ])
  assert.match(clause, /KNOWLEDGE DOCUMENTS/)
  assert.match(clause, /CALIBRATE/)
  assert.match(clause, /Content driver/)
  assert.match(clause, /brief\.pdf \(excerpt, truncated\)/)
  assert.match(clause, /Tone of voice sobrio/)
  assert.match(clause, /note\.txt/)
})
