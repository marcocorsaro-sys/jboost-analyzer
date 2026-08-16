/**
 * V4 Block 3 — setup validation tests.
 *
 * Run: npx tsx --test lib/v4/setup.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  appliesTo,
  buildSetup,
  buildTemplates,
  buildV4SetupJson,
  driverConfigFromSetup,
  isHttpUrl,
  mergeV4Setup,
  withMandatoryDrivers,
  MANDATORY_DRIVER_KEYS,
  TEMPLATE_KEYS,
} from './setup'
import type { AnalysisSite } from './runner/types'

function base() {
  return {
    client: { domain: 'https://www.client.com/some/path?x=1', brandName: 'Client' },
    competitors: [{ domain: 'comp1.com', brandName: 'Comp One' }],
    country: 'IT',
    countries: ['IT'],
    outputLanguage: 'it' as const,
    siteType: 'ecommerce',
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
    competitors: [{ domain: '' }, { domain: 'comp1.com', brandName: 'Comp One' }, { domain: '   ' }],
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
// STEP 1/2 required fields — launch vs draft (Bibbia 04)
// ---------------------------------------------------------------------------

test('launch: missing brand name, site type, countries and competitors all block', () => {
  const { errors } = buildSetup({
    ...base(),
    client: { domain: 'client.com' },
    competitors: [],
    countries: [],
    siteType: null,
  })
  assert.ok(errors.some((e) => e.includes('brand name del cliente')))
  assert.ok(errors.some((e) => e.includes('site type è obbligatorio')))
  assert.ok(errors.some((e) => e.includes('paese di analisi')))
  assert.ok(errors.some((e) => e.includes('almeno un competitor')))
})

test('launch: a competitor without brand name blocks (field #10b)', () => {
  const { errors } = buildSetup({ ...base(), competitors: [{ domain: 'comp1.com' }] })
  assert.ok(errors.some((e) => e.includes('brand name obbligatorio per il competitor 1')))
})

test('draft: the same incomplete setup saves with no errors', () => {
  const { errors } = buildSetup({
    ...base(),
    client: { domain: 'client.com' },
    competitors: [],
    countries: [],
    siteType: null,
    drivers: [],
    mode: 'draft',
  })
  assert.deepEqual(errors, [])
})

test('an invalid site type blocks even a draft', () => {
  const { errors } = buildSetup({ ...base(), siteType: 'blog', mode: 'draft' })
  assert.ok(errors.some((e) => e.includes('site type non valido')))
})

test('an invalid target audience mode is rejected', () => {
  const { errors } = buildSetup({
    ...base(),
    targetAudienceMode: 'everyone' as unknown as 'b2b',
  })
  assert.ok(errors.some((e) => e.includes('target audience non valido')))
})

// ---------------------------------------------------------------------------
// STEP 3/4 bounded optionals — clusters, max insights, driver templates
// ---------------------------------------------------------------------------

test('clusters: fewer than 3 blocks the launch but not the draft', () => {
  const partial = { ...base(), thematicClusters: ['Destinazioni', 'Navi'] }
  assert.ok(
    buildSetup(partial).errors.some((e) => e.includes('thematic cluster')),
    'launch must reject 2 clusters',
  )
  assert.deepEqual(buildSetup({ ...partial, mode: 'draft' as const }).errors, [])
})

test('clusters: more than 10 blocks even a draft', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => `tema ${i}`)
  const { errors } = buildSetup({ ...base(), thematicClusters: eleven, mode: 'draft' })
  assert.ok(errors.some((e) => e.includes('massimo 10')))
})

test('clusters: 3-10 with blank entries cleaned passes', () => {
  const { errors } = buildSetup({
    ...base(),
    thematicClusters: [' Destinazioni ', 'Navi', 'Vita a bordo', '  '],
  })
  assert.deepEqual(errors, [])
})

test('max insights must be a positive integer when given', () => {
  assert.ok(buildSetup({ ...base(), maxInsights: 0 }).errors.some((e) => e.includes('intero positivo')))
  assert.ok(buildSetup({ ...base(), maxInsights: 2.5 }).errors.some((e) => e.includes('intero positivo')))
  assert.ok(buildSetup({ ...base(), maxInsights: -3, mode: 'draft' }).errors.length > 0)
  assert.deepEqual(buildSetup({ ...base(), maxInsights: 3 }).errors, [])
  assert.deepEqual(buildSetup({ ...base(), maxInsights: null }).errors, [])
})

test('driver templates: unknown driver or template key is rejected', () => {
  assert.ok(
    buildSetup({ ...base(), driverTemplates: { authority: ['homepage'] } }).errors.some((e) =>
      e.includes('driver senza template'),
    ),
  )
  assert.ok(
    buildSetup({ ...base(), driverTemplates: { speed: ['checkout'] } }).errors.some((e) =>
      e.includes('template sconosciuto'),
    ),
  )
})

// ---------------------------------------------------------------------------
// Mandatory Business drivers
// ---------------------------------------------------------------------------

test('withMandatoryDrivers: the Business four are always present, deduped', () => {
  const out = withMandatoryDrivers(['authority', 'traffic'])
  for (const k of MANDATORY_DRIVER_KEYS) assert.ok(out.includes(k))
  assert.equal(out.filter((k) => k === 'traffic').length, 1)
  assert.deepEqual(withMandatoryDrivers([]), [...MANDATORY_DRIVER_KEYS])
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

test('templates: applies_to mirrors the per-driver selection when given', () => {
  const out = buildTemplates(
    [SITES[0]],
    { client: { pdp: 'https://client.com/p/1' } },
    [],
    { speed: ['pdp', 'homepage'], accessibility: ['pdp'], schema: [], content: [] },
  )
  const pdp = out.find((t) => t.template_key === 'pdp')
  assert.deepEqual(pdp?.applies_to, ['speed', 'accessibility'])
  const homepage = out.find((t) => t.template_key === 'homepage')
  assert.deepEqual(homepage?.applies_to, ['speed'])
})

test('appliesTo: no selection at all keeps the historical all-four default', () => {
  assert.deepEqual(appliesTo('homepage'), ['speed', 'accessibility', 'schema', 'content'])
  assert.deepEqual(appliesTo('homepage', {}), ['speed', 'accessibility', 'schema', 'content'])
})

test('appliesTo: an unselected template falls to the drivers WITHOUT a selection', () => {
  // Speed chose its pages explicitly; content gave no selection, so a stray
  // URL still belongs to content rather than silently belonging to nobody.
  assert.deepEqual(appliesTo('faq', { speed: ['homepage'] }), ['accessibility', 'schema', 'content'])
})

// ---------------------------------------------------------------------------
// v4_setup json + downstream driver config seeding
// ---------------------------------------------------------------------------

test('driverConfigFromSetup: jhorizon answer, clusters and uploads reach their drivers', () => {
  const v4Setup = mergeV4Setup(
    {
      attachments: [
        { kind: 'compliance_crawl', name: 'crawl.xlsx', path: 'v4-setup/a/compliance_crawl/crawl.xlsx', size: 10, uploaded_at: 'now' },
        { kind: 'authority_backlinks', name: 'links.csv', path: 'v4-setup/a/authority_backlinks/links.csv', size: 20, uploaded_at: 'now' },
        { kind: 'knowledge_doc', name: 'brief.pdf', path: 'v4-setup/a/knowledge_doc/brief.pdf', size: 30, uploaded_at: 'now' },
      ],
    },
    buildV4SetupJson({
      ...base(),
      jhorizonAnswer: '  recap J-Horizon  ',
      thematicClusters: ['Destinazioni', 'Navi', 'Offerte'],
    }),
  )

  const cfg = driverConfigFromSetup(v4Setup)
  assert.equal(cfg.ai_visibility?.jhorizon_answer, 'recap J-Horizon')
  assert.deepEqual(cfg.discoverability?.configured_clusters, ['Destinazioni', 'Navi', 'Offerte'])
  assert.equal((cfg.compliance?.attachments as Array<{ name: string }>)[0].name, 'crawl.xlsx')
  assert.equal((cfg.authority?.attachments as Array<{ name: string }>)[0].name, 'links.csv')
  // knowledge docs are global context, not a driver's attachment
  assert.equal(cfg.compliance && 'jhorizon_answer' in cfg.compliance, false)
  assert.equal(Object.keys(cfg).sort().join(','), 'ai_visibility,authority,compliance,discoverability')
})

test('driverConfigFromSetup: an empty setup seeds nothing', () => {
  assert.deepEqual(driverConfigFromSetup(null), {})
  assert.deepEqual(driverConfigFromSetup(buildV4SetupJson(base())), {})
})

test('mergeV4Setup: a wizard save never wipes the uploaded attachments', () => {
  const existing = { attachments: [{ kind: 'knowledge_doc', name: 'a.pdf', path: 'p', size: 1, uploaded_at: 'now' }] }
  const merged = mergeV4Setup(existing, buildV4SetupJson(base()))
  assert.equal((merged.attachments as unknown[]).length, 1)
  assert.deepEqual(mergeV4Setup(null, buildV4SetupJson(base())).attachments, [])
})

test('buildV4SetupJson: trims and nulls empty optional text', () => {
  const json = buildV4SetupJson({ ...base(), jhorizonAnswer: '   ', additionalNotes: ' note ', sector: '' })
  assert.equal(json.jhorizon_answer, null)
  assert.equal(json.additional_notes, 'note')
  assert.equal(json.sector, null)
  assert.deepEqual(json.enabled_drivers, ['authority'])
})

test('isHttpUrl: only http(s) absolute URLs', () => {
  assert.ok(isHttpUrl('https://a.com/x'))
  assert.ok(isHttpUrl('http://a.com'))
  assert.equal(isHttpUrl('ftp://a.com'), false)
  assert.equal(isHttpUrl('a.com'), false)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)
})
