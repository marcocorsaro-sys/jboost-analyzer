/**
 * V4 Block 3 — setup validation tests.
 *
 * Run: npx tsx --test lib/v4/setup.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildSetup, buildTemplates, isHttpUrl, TEMPLATE_KEYS } from './setup'
import type { AnalysisSite } from './runner/types'

function base() {
  return {
    client: { domain: 'https://www.client.com/some/path?x=1' },
    competitors: [{ domain: 'comp1.com' }],
    country: 'IT',
    outputLanguage: 'it' as const,
    drivers: ['authority'],
  }
}

test('setup: domains are normalized to bare hosts', () => {
  const { sites, errors } = buildSetup(base())
  assert.deepEqual(errors, [])
  assert.deepEqual(sites.map((s) => s.domain), ['client.com', 'comp1.com'])
  assert.deepEqual(sites.map((s) => s.site_ref), ['client', 'competitor_1'])
})

test('setup: a missing client domain is a blocking error', () => {
  const { errors } = buildSetup({ ...base(), client: { domain: '  ' } })
  assert.ok(errors.some((e) => e.includes('dominio del cliente')))
})

test('setup: the same domain twice in the set is rejected', () => {
  const { errors } = buildSetup({
    ...base(),
    competitors: [{ domain: 'comp1.com' }, { domain: 'https://comp1.com' }],
  })
  assert.ok(errors.some((e) => e.includes('duplicato')))
})

test('setup: the client cannot also be a competitor', () => {
  const { errors } = buildSetup({ ...base(), competitors: [{ domain: 'www.client.com' }] })
  assert.ok(errors.some((e) => e.includes('duplicato')))
})

test('setup: at most 4 competitors', () => {
  const { errors } = buildSetup({
    ...base(),
    competitors: ['a', 'b', 'c', 'd', 'e'].map((d) => ({ domain: `${d}.com` })),
  })
  assert.ok(errors.some((e) => e.includes('4 competitor')))
})

test('setup: no driver selected is an error', () => {
  const { errors } = buildSetup({ ...base(), drivers: [] })
  assert.ok(errors.some((e) => e.includes('almeno un driver')))
})

test('setup: empty competitor rows are ignored, not treated as sites', () => {
  const { sites, errors } = buildSetup({
    ...base(),
    competitors: [{ domain: '' }, { domain: 'comp1.com' }, { domain: '   ' }],
  })
  assert.deepEqual(errors, [])
  assert.equal(sites.length, 2)
})

test('setup: brand variants are trimmed and emptied entries dropped', () => {
  const { sites } = buildSetup({
    ...base(),
    client: { domain: 'client.com', brandName: 'Client', brandVariants: [' Client Group ', '', '  '] },
  })
  assert.deepEqual(sites[0].brand_variants, ['Client Group'])
})

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

const SITES: AnalysisSite[] = [
  { site_ref: 'client', domain: 'client.com', name: 'Client', is_client: true },
  { site_ref: 'competitor_1', domain: 'comp1.com', name: 'C1', is_client: false },
]

test('templates: every site gets a homepage by default', () => {
  const errors: string[] = []
  const out = buildTemplates(SITES, {}, errors)
  assert.deepEqual(errors, [])
  assert.deepEqual(
    out.map((t) => [t.site_ref, t.template_key, t.url]),
    [
      ['client', 'homepage', 'https://client.com'],
      ['competitor_1', 'homepage', 'https://comp1.com'],
    ],
  )
})

test('templates: a blank template is absent, not invented', () => {
  const errors: string[] = []
  const out = buildTemplates(SITES, { client: { pdp: '   ' } }, errors)
  assert.deepEqual(errors, [])
  assert.equal(out.filter((t) => t.template_key === 'pdp').length, 0)
})

test('templates: an explicit homepage overrides the default', () => {
  const errors: string[] = []
  const out = buildTemplates(SITES, { client: { homepage: 'https://client.com/it/' } }, errors)
  assert.equal(out.find((t) => t.site_ref === 'client')?.url, 'https://client.com/it/')
})

test('templates: a malformed URL is an error, never silently stored', () => {
  const errors: string[] = []
  const out = buildTemplates(SITES, { client: { pdp: 'client.com/p/1' } }, errors)
  assert.equal(out.filter((t) => t.template_key === 'pdp').length, 0)
  assert.ok(errors.some((e) => e.includes('URL non valida')))
})

test('templates: all nine template keys can be configured', () => {
  const errors: string[] = []
  const given = Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, `https://client.com/${k}`]))
  const out = buildTemplates([SITES[0]], { client: given }, errors)
  assert.deepEqual(errors, [])
  assert.equal(out.length, TEMPLATE_KEYS.length)
})

test('templates: applies_to names the drivers that consume the page', () => {
  const out = buildTemplates([SITES[0]], {}, [])
  assert.deepEqual(out[0].applies_to, ['speed', 'accessibility', 'schema', 'content'])
})

test('isHttpUrl: only http(s) absolute URLs', () => {
  assert.ok(isHttpUrl('https://a.com/x'))
  assert.ok(isHttpUrl('http://a.com'))
  assert.equal(isHttpUrl('ftp://a.com'), false)
  assert.equal(isHttpUrl('a.com'), false)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)
})
