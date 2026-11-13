/**
 * Run: npx tsx --test lib/v4/schema-compare.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchemaComparison, typeRowsFor } from './schema-compare'

const type = (t: string, over: Record<string, unknown> = {}) => ({
  type: t, applicable: true, detected: true, level: 0.5, reason: 'r',
  missing_mandatory: [], missing_recommended: ['sku'], missing_advanced: [], nodes: 1, valid_jsonld: true, ...over,
})

test('buildSchemaComparison: groups by template in wizard order, per site', () => {
  const cmp = buildSchemaComparison([
    { site_ref: 'client', domain: 'c.com', evidence: { per_template: [
      { template_key: 'pdp', url: 'https://c.com/p', scraped: true, score: 60, types: [type('Product')] },
      { template_key: 'homepage', url: 'https://c.com', scraped: true, score: 40, types: [type('Organization')] },
    ] } },
    { site_ref: 'competitor_1', domain: 'x.com', evidence: { per_template: [
      { template_key: 'pdp', url: 'https://x.com/p', scraped: false, error: 'HTTP 403', score: null, types: [] },
    ] } },
  ])
  assert.equal(cmp.hasDetail, true)
  assert.deepEqual(cmp.templates.map((t) => t.key), ['homepage', 'pdp'])
  assert.equal(cmp.cells.pdp.client.score, 60)
  assert.equal(cmp.cells.pdp.competitor_1.scraped, false)
  assert.equal(cmp.cells.homepage.competitor_1, undefined)
})

test('buildSchemaComparison: evidence without per_template reports no detail', () => {
  const cmp = buildSchemaComparison([{ site_ref: 'client', domain: 'c.com', evidence: { types_found: [] } }])
  assert.equal(cmp.hasDetail, false)
  assert.deepEqual(cmp.templates, [])
})

test('typeRowsFor: applicable types first, detected-only extras last, no duplicates', () => {
  const rows = typeRowsFor({
    client: { template_key: 'faq', url: '', scraped: true, error: null, score: 50, types_found_outside_kb: [],
      types: [type('FAQPage'), type('Organization', { applicable: false })] },
    competitor_1: { template_key: 'faq', url: '', scraped: true, error: null, score: 0, types_found_outside_kb: [],
      types: [type('FAQPage'), type('BreadcrumbList', { detected: false, level: 0 })] },
  })
  assert.deepEqual(rows, [
    { type: 'FAQPage', extra: false },
    { type: 'BreadcrumbList', extra: false },
    { type: 'Organization', extra: true },
  ])
})
