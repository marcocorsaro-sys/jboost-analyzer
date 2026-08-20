/**
 * V4 — template-URL autocomplete ranking tests.
 * Run: npx tsx --test lib/v4/url-autocomplete.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTOCOMPLETE_LIMIT,
  isBareDomain,
  rankSitemapUrls,
  type SitemapUrlEntry,
} from './url-autocomplete'

const entry = (url: string, role: string): SitemapUrlEntry => ({ url, role })

const SAMPLE: SitemapUrlEntry[] = [
  entry('https://acme.com', 'homepage'),
  entry('https://acme.com/p/red-shoe', 'product'),
  entry('https://acme.com/p/blue-shoe-limited-edition', 'product'),
  entry('https://acme.com/collections/shoes', 'category'),
  entry('https://acme.com/blog/how-to-choose-shoes', 'blog'),
  entry('https://acme.com/news/spring-drop', 'news'),
  entry('https://acme.com/faq', 'faq'),
  entry('https://acme.com/about-us', 'about'),
  entry('https://acme.com/contact', 'contact'),
]

test('autocomplete: template role wins over shorter URLs of other roles', () => {
  const out = rankSitemapUrls(SAMPLE, { query: '', templateKey: 'pdp' })
  // Both product URLs come first even though /faq and the homepage are shorter.
  assert.deepEqual(
    out.slice(0, 2).map((u) => u.url),
    ['https://acme.com/p/red-shoe', 'https://acme.com/p/blue-shoe-limited-edition'],
  )
  assert.ok(out.slice(2).every((u) => u.role !== 'product'))
})

test('autocomplete: article template accepts article, blog and news roles', () => {
  const out = rankSitemapUrls(SAMPLE, { query: '', templateKey: 'article' })
  assert.deepEqual(
    out.slice(0, 2).map((u) => u.role).sort(),
    ['blog', 'news'],
  )
})

test('autocomplete: substring filter keeps only matching URLs', () => {
  const out = rankSitemapUrls(SAMPLE, { query: 'shoe', templateKey: 'pdp' })
  assert.ok(out.length > 0)
  assert.ok(out.every((u) => u.url.includes('shoe')))
  assert.equal(out[0].role, 'product') // role priority still applies after the filter
})

test('autocomplete: substring match is case-insensitive', () => {
  const upper = rankSitemapUrls(SAMPLE, { query: 'SHOE', templateKey: 'plp' })
  const lower = rankSitemapUrls(SAMPLE, { query: 'shoe', templateKey: 'plp' })
  assert.deepEqual(upper, lower)
  assert.equal(upper[0].url, 'https://acme.com/collections/shoes')
})

test('autocomplete: empty query returns everything (within the cap), shortest first per rank', () => {
  const out = rankSitemapUrls(SAMPLE, { query: '', templateKey: 'faq' })
  assert.equal(out.length, Math.min(SAMPLE.length, AUTOCOMPLETE_LIMIT))
  assert.equal(out[0].url, 'https://acme.com/faq')
})

test('autocomplete: results are capped at 8', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    entry(`https://acme.com/p/item-${String(i).padStart(2, '0')}`, 'product'),
  )
  const out = rankSitemapUrls(many, { query: 'item', templateKey: 'pdp' })
  assert.equal(out.length, AUTOCOMPLETE_LIMIT)
})

test('autocomplete: global (and unknown) template keys are role-neutral, shortest URL first', () => {
  const global = rankSitemapUrls(SAMPLE, { query: '', templateKey: 'global' })
  assert.equal(global[0].url, 'https://acme.com') // homepage is simply the shortest
  const unknown = rankSitemapUrls(SAMPLE, { query: '', templateKey: 'not_a_template' })
  assert.deepEqual(unknown, global) // no crash, same neutral ordering
})

test('autocomplete: unknown roles never break the ranking', () => {
  const weird = [entry('https://acme.com/x', 'mystery'), ...SAMPLE]
  const out = rankSitemapUrls(weird, { query: '', templateKey: 'pdp' })
  assert.equal(out[0].role, 'product')
  assert.ok(out.some((u) => u.role === 'mystery')) // still listed, after the matches
})

test('bare domain guard: accepts bare domains only', () => {
  assert.ok(isBareDomain('benetton.com'))
  assert.ok(isBareDomain('shop.example.co.uk'))
  assert.ok(!isBareDomain('https://benetton.com'))
  assert.ok(!isBareDomain('benetton'))
  assert.ok(!isBareDomain(''))
})
