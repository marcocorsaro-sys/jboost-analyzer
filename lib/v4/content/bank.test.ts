/**
 * V4 Content — question bank invariants (Bibbia sheets 9a/9b).
 *
 * Run: npx tsx --test lib/v4/content/bank.test.ts
 *
 * These tests pin the transcription to the source's own structural rules, so
 * an accidental edit to a point value or a question cannot pass silently.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ANSWER_LABELS,
  CONTENT_BANK,
  CONTENT_TEMPLATE_KEYS,
  getContentTemplate,
  isContentTemplateKey,
  templateMaxPoints,
} from './bank'

test('bank: exactly 9 templates, keyed like the content_answers CHECK constraint', () => {
  assert.equal(CONTENT_BANK.length, 9)
  // Same set as the Block 1 migration CHECK — a bank key is storable as-is.
  assert.deepEqual(
    [...CONTENT_TEMPLATE_KEYS].sort(),
    ['about', 'article', 'faq', 'global', 'homepage', 'listing_articles', 'pdp', 'plp', 'service_page'],
  )
  assert.ok(isContentTemplateKey('plp'))
  assert.ok(!isContentTemplateKey('landing'))
})

test('bank: every question has exactly 4 answers A-D, ascending points, A = 0', () => {
  for (const template of CONTENT_BANK) {
    for (const q of template.questions) {
      assert.equal(q.answers.length, 4, `${template.key} Q${q.id}`)
      assert.deepEqual(
        q.answers.map((a) => a.key),
        ['A', 'B', 'C', 'D'],
        `${template.key} Q${q.id} keys`,
      )
      assert.equal(q.answers[0].points, 0, `${template.key} Q${q.id}: A must be 0`)
      for (let i = 1; i < q.answers.length; i++) {
        assert.ok(
          q.answers[i].points > q.answers[i - 1].points,
          `${template.key} Q${q.id}: points must be strictly ascending (${q.answers[i - 1].key}=${q.answers[i - 1].points} -> ${q.answers[i].key}=${q.answers[i].points})`,
        )
      }
    }
  }
})

test('bank: answer labels are the 9a v5 scale (A=Very bad ... D=Very good)', () => {
  assert.deepEqual(ANSWER_LABELS, { A: 'Very bad', B: 'Bad', C: 'Good', D: 'Very good' })
  for (const template of CONTENT_BANK) {
    for (const q of template.questions) {
      for (const a of q.answers) {
        assert.equal(a.label, ANSWER_LABELS[a.key], `${template.key} Q${q.id} ${a.key}`)
        assert.ok(a.description.length > 0, `${template.key} Q${q.id} ${a.key}: empty description`)
      }
    }
  }
})

test('bank: max points sum to 100 for every template except article', () => {
  for (const template of CONTENT_BANK) {
    if (template.key === 'article') continue
    assert.equal(templateMaxPoints(template), 100, template.key)
    // In the consistent templates, each question's max equals its weight.
    for (const q of template.questions) {
      assert.equal(Math.max(...q.answers.map((a) => a.points)), q.weight, `${template.key} Q${q.id}`)
    }
  }
})

test('bank: article is transcribed AS-IS — 6 questions (1,2,3,4,6,7), max points 85', () => {
  const article = getContentTemplate('article')
  assert.ok(article)
  // The source's own anomaly (9a "Open point"): question #5 "Use of bolds"
  // was absorbed into #4, and several max points are lower than the stated
  // weight (Q1 10<15, Q4 15<20, Q7 15<20), so the sum is 85, not 100. The
  // scoring engine normalizes by the template's own max, so a full-marks
  // Article still scores 100.
  assert.deepEqual(article.questions.map((q) => q.id), [1, 2, 3, 4, 6, 7])
  assert.equal(templateMaxPoints(article), 85)
  const maxById = new Map(article.questions.map((q) => [q.id, Math.max(...q.answers.map((a) => a.points))]))
  assert.equal(maxById.get(1), 10) // weight 15
  assert.equal(maxById.get(4), 15) // weight 20
  assert.equal(maxById.get(7), 15) // weight 20
})

test('bank: question ids are progressive and unique per template', () => {
  for (const template of CONTENT_BANK) {
    const ids = template.questions.map((q) => q.id)
    assert.deepEqual([...new Set(ids)], ids, `${template.key}: duplicate question ids`)
    assert.deepEqual([...ids].sort((a, b) => a - b), ids, `${template.key}: ids out of order`)
    if (template.key === 'global') assert.equal(ids.length, 4) // 9a: Global has 4 questions
    else if (template.key === 'article') assert.equal(ids.length, 6)
    else assert.equal(ids.length, 5, template.key)
  }
})
