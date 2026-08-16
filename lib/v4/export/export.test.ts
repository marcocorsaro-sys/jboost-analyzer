/**
 * V4 — export tests: the shared report model (the story the three formats
 * tell) plus a smoke test that each generator produces real bytes from the
 * same fixture without throwing (docx and pptxgenjs run in plain Node).
 *
 * Run: npx tsx --test lib/v4/export/export.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildReportModel,
  toBullets,
  fmtScore,
  type ExportAnalysisRow,
  type ExportRunRow,
  type ExportSite,
} from './report-model'
import { generateDocx } from './to-docx'
import { generatePptx } from './to-pptx'
import { generateArtifact } from './to-artifact'

// ---------------------------------------------------------------------------
// Fixture: 1 client + 2 competitors, one done business driver with insight
// (Discoverability), one done development driver (Speed), one errored driver
// (Traffic), one still-running driver (Authority).
// ---------------------------------------------------------------------------

const SITES: ExportSite[] = [
  { site_ref: 'client', domain: 'cliente.it', name: 'Cliente', is_client: true },
  { site_ref: 'comp_1', domain: 'compA.com', name: 'Comp A', is_client: false },
  { site_ref: 'comp_2', domain: 'compB.com', name: 'Comp B', is_client: false },
]

const ANALYSIS: ExportAnalysisRow = {
  id: 'a-1',
  domain: 'cliente.it',
  brand_name: 'Cliente SpA',
  industry_preset: 'retail_luxury',
  output_language: 'it',
  ref_date: '2026-07-31',
  v4_executive_summary: {
    status: 'done',
    output: {
      headline_dominante: 'Domanda brand forte, cattura organica debole.',
      scorecard_overview: 'Il cliente guida in Awareness ma perde in Discoverability.',
      correlazioni_chiave: [
        { titolo: 'Brand vs SEO', spiegazione: 'Awareness alta e Discoverability bassa.', driver_coinvolti: ['awareness', 'discoverability'] },
      ],
      priorita_strategiche: [
        { titolo: 'Chiudere il gap keyword', razionale: 'Il cluster leader copre 4x le keyword.', driver_impattati: ['discoverability'], orizzonte_temporale_mesi: 3, impatto_atteso: 'alto' },
        { titolo: 'Core Web Vitals', razionale: 'LCP mobile oltre soglia sui template PDP.', driver_impattati: ['speed'], orizzonte_temporale_mesi: 6, impatto_atteso: 'medio' },
      ],
      alert_critici: ['Discoverability al tier relaxed_2: base ampliata a top-20 / vol>=500.'],
    },
    model: 'test',
    generated_at: '2026-08-01T00:00:00Z',
    attempts: 1,
  },
}

/** 7 items: the model must cap issues/solutions at 5 (README 01 §6: 3-5). */
const SEVEN_ITEMS = Array.from({ length: 7 }, (_, i) => ({
  titolo: `Problema ${i + 1}`,
  spiegazione: `Spiegazione del problema ${i + 1} con un dato numerico.`,
  soluzione_proposta: `Correggere la causa del problema ${i + 1}.`,
  priorita: i < 2 ? 'alta' : 'media',
}))

const RUNS: ExportRunRow[] = [
  {
    driver_key: 'discoverability',
    enabled: true,
    status: 'done',
    raw_value: 120,
    score_absolute: null,
    score_relative: 25,
    comment_absolute: null,
    comment_relative: null,
    tier_used: 'relaxed_2',
    error: null,
    raw_payload: {
      sites: [
        {
          site_ref: 'client',
          domain: 'cliente.it',
          raw: 120,
          score_relative: 25,
          rank: 3,
          evidence: {
            tier: 'relaxed_2',
            tier_rule: { position_max: 20, volume_min: 500 },
            kw_count: 120,
            keyword_gap_top: [
              { keyword: 'divani design', volume: 4400, competitor_position: 3, client_position: 34 },
              { keyword: 'lampade led', volume: 2900, competitor_position: 5, client_position: 51 },
            ],
          },
        },
        { site_ref: 'comp_1', domain: 'compA.com', raw: 480, score_relative: 100, rank: 1, evidence: {} },
        { site_ref: 'comp_2', domain: 'compB.com', raw: 300, score_relative: 62.5, rank: 2, evidence: {} },
      ],
    },
    llm_insight: {
      status: 'done',
      output: {
        commento_relative:
          'Il cliente conta 120 keyword non-brand qualificate, un quarto del leader. Il gap si concentra su due cluster. La distribuzione premia il leader su tutte le fasce. La dinamica è stabile.',
        insights: [
          { titolo: 'Gap sul cluster arredo', spiegazione: 'Il leader copre 4x le keyword del cliente.', rilevanza_strategica: 'alta' },
          { titolo: 'Poca presenza in top 3', spiegazione: 'Solo 8 keyword in top 3.', rilevanza_strategica: 'media' },
        ],
      },
      model: 'test',
      generated_at: '2026-08-01T00:00:00Z',
      attempts: 1,
    },
  },
  {
    driver_key: 'speed',
    enabled: true,
    status: 'done',
    raw_value: 61,
    score_absolute: 61,
    score_relative: 76.3,
    comment_absolute: null,
    comment_relative: null,
    tier_used: null,
    error: null,
    raw_payload: {
      sites: [
        { site_ref: 'client', domain: 'cliente.it', raw: 61, score_absolute: 61, score_relative: 76.3, rank: 2, evidence: { mobile_avg: 48, desktop_avg: 74 } },
        { site_ref: 'comp_1', domain: 'compA.com', raw: 80, score_absolute: 80, score_relative: 100, rank: 1, evidence: {} },
      ],
    },
    llm_insight: {
      status: 'done',
      output: {
        commento_absolute: 'Lo score PSI medio del cliente è 61 su 100.',
        commento_relative: 'Il cliente è secondo su tre nel set, dietro Comp A.',
        items: SEVEN_ITEMS,
      },
      model: 'test',
      generated_at: '2026-08-01T00:00:00Z',
      attempts: 1,
    },
  },
  {
    driver_key: 'traffic',
    enabled: true,
    status: 'error',
    raw_value: null,
    score_absolute: null,
    score_relative: null,
    comment_absolute: null,
    comment_relative: null,
    tier_used: null,
    error: 'Domain below Similarweb coverage: update competitor list',
    raw_payload: {},
    llm_insight: null,
  },
  {
    driver_key: 'authority',
    enabled: true,
    status: 'running',
    raw_value: null,
    score_absolute: null,
    score_relative: null,
    comment_absolute: null,
    comment_relative: null,
    tier_used: null,
    error: null,
    raw_payload: {},
    llm_insight: null,
  },
  // Disabled driver: must not appear in the report at all.
  {
    driver_key: 'schema',
    enabled: false,
    status: 'queued',
    raw_value: null,
    score_absolute: null,
    score_relative: null,
    comment_absolute: null,
    comment_relative: null,
    tier_used: null,
    error: null,
    raw_payload: {},
    llm_insight: null,
  },
]

const NOW = new Date('2026-08-16T10:00:00Z')

function model() {
  return buildReportModel(ANALYSIS, SITES, RUNS, NOW)
}

// ---------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------

test('export model: a done driver carries the 5 golden-standard sections', () => {
  const m = model()
  const disco = m.drivers.find((d) => d.key === 'discoverability')
  assert.ok(disco)
  // 1 · Score: client + competitors side by side.
  assert.equal(disco.scores.length, 3)
  assert.equal(disco.scores[0].isClient, true)
  assert.equal(disco.scores[0].scoreRelative, 25)
  // 2 · Summary: 3-4 sober bullets.
  assert.equal(disco.summaryStatus, 'done')
  assert.ok(disco.summaryBullets.length >= 3 && disco.summaryBullets.length <= 4)
  // 3 · Data: evidence scalars + tables.
  assert.ok(disco.dataRows.length > 0)
  assert.ok(disco.dataTables.some((t) => t.title.startsWith('keyword_gap_top')))
  // 4/5 · Issues and solutions present (business: solutions via exec summary note).
  assert.ok(disco.issues.length >= 1)
  assert.ok(disco.solutionsNote)
})

test('export model: driver order is the Business-first UI order', () => {
  const m = model()
  assert.deepEqual(
    m.drivers.map((d) => d.key),
    ['discoverability', 'traffic', 'speed', 'authority'],
  )
  // The disabled schema run never enters the report.
  assert.ok(!m.drivers.some((d) => d.key === 'schema'))
})

test('export model: an errored driver is reported as an error, with no invented numbers', () => {
  const m = model()
  const traffic = m.drivers.find((d) => d.key === 'traffic')
  assert.ok(traffic)
  assert.equal(traffic.status, 'error')
  assert.match(String(traffic.statusNote), /Similarweb/)
  assert.equal(traffic.scores.length, 0)
  const overviewRow = m.overview.rows.find((r) => r.key === 'traffic')
  assert.equal(overviewRow?.scoreRelative, null)
  assert.equal(overviewRow?.rank, null)
})

test('export model: a still-running driver is "not measured", never a 0', () => {
  const m = model()
  const authority = m.drivers.find((d) => d.key === 'authority')
  assert.equal(authority?.status, 'pending')
  assert.equal(authority?.scores.length, 0)
  assert.notEqual(m.overview.rows.find((r) => r.key === 'authority')?.scoreRelative, 0)
})

test('export model: Discoverability data carry the explicit thresholds and tier', () => {
  const m = model()
  const disco = m.drivers.find((d) => d.key === 'discoverability')
  assert.ok(disco?.criteria)
  // The criterion states the actual numbers of the tier used (relaxed_2).
  assert.match(disco!.criteria!, /top 20/)
  assert.match(disco!.criteria!, /500/)
  assert.match(disco!.criteria!, /relaxed_2/)
})

test('export model: issues and solutions are capped at 5', () => {
  const m = model()
  const speed = m.drivers.find((d) => d.key === 'speed')
  assert.equal(speed?.issues.length, 5)
  assert.equal(speed?.solutions.length, 5)
  // The issue table carries the golden-standard columns' content.
  const row = speed!.issues[0]
  assert.equal(row.area, 'Speed')
  assert.equal(row.problem, 'Problema 1')
  assert.match(row.solution, /Correggere/)
  assert.equal(row.priority, 'alta')
})

test('export model: language follows output_language (it and en)', () => {
  const it = model()
  assert.equal(it.lang, 'it')
  assert.equal(it.labels.secSolutions, 'Soluzioni')
  assert.match(it.drivers.find((d) => d.key === 'discoverability')!.criteria!, /keyword non-brand/)

  const en = buildReportModel({ ...ANALYSIS, output_language: 'en' }, SITES, RUNS, NOW)
  assert.equal(en.lang, 'en')
  assert.equal(en.labels.secSolutions, 'Solutions')
  assert.match(en.drivers.find((d) => d.key === 'discoverability')!.criteria!, /non-brand keywords/)
})

test('export model: missing executive summary → section marked not generated', () => {
  const m = buildReportModel({ ...ANALYSIS, v4_executive_summary: null }, SITES, RUNS, NOW)
  assert.equal(m.summary.status, 'not_generated')
  assert.equal(m.summary.headline, null)
  assert.equal(m.summary.priorities.length, 0)
})

test('export model: missing per-driver insight → narrative sections marked, data still there', () => {
  const runs = RUNS.map((r) =>
    r.driver_key === 'speed' ? { ...r, llm_insight: null } : r,
  )
  const m = buildReportModel(ANALYSIS, SITES, runs, NOW)
  const speed = m.drivers.find((d) => d.key === 'speed')
  assert.equal(speed?.summaryStatus, 'not_generated')
  assert.equal(speed?.issuesStatus, 'not_generated')
  assert.equal(speed?.issues.length, 0)
  // The measurement itself still ships.
  assert.equal(speed?.scores[0]?.scoreAbsolute, 61)
})

test('export model: executive summary parsed into headline/priorities/alerts', () => {
  const m = model()
  assert.equal(m.summary.status, 'done')
  assert.match(String(m.summary.headline), /Domanda brand/)
  assert.equal(m.summary.priorities.length, 2)
  assert.equal(m.summary.priorities[0].horizonMonths, 3)
  assert.equal(m.summary.alerts.length, 1)
})

test('export model helpers: bullets and score formatting', () => {
  assert.deepEqual(toBullets('Una frase. Due frasi.'), ['Una frase.', 'Due frasi.'])
  // More than 4 sentences: merged tail, nothing dropped.
  const six = toBullets('A. B. C. D. E. F.')
  assert.equal(six.length, 4)
  assert.match(six[3], /F\./)
  assert.equal(fmtScore(null), '—')
  assert.equal(fmtScore(76.34), '76.3')
})

// ---------------------------------------------------------------------------
// Generator smoke tests: real bytes from the fixture, no throw.
// ---------------------------------------------------------------------------

test('export smoke: docx generator produces a non-empty buffer', async () => {
  const buf = await generateDocx(model())
  assert.ok(Buffer.isBuffer(buf))
  assert.ok(buf.length > 1000)
  // A .docx is a zip: PK signature.
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK')
})

test('export smoke: pptx generator produces a non-empty buffer', async () => {
  const buf = await generatePptx(model())
  assert.ok(buf.length > 1000)
  assert.equal(Buffer.from(buf.subarray(0, 2)).toString('latin1'), 'PK')
})

test('export smoke: artifact generator produces a self-contained HTML string', () => {
  const html = generateArtifact(model())
  assert.ok(html.length > 2000)
  assert.match(html, /^<!DOCTYPE html>/)
  // Anchors per driver + the thresholds in the visible text.
  assert.match(html, /id="drv-discoverability"/)
  assert.match(html, /top 20/)
  assert.match(html, /relaxed_2/)
  // No external runtime dependencies.
  assert.ok(!/src="http/.test(html))
  assert.ok(!/<link /.test(html))
  // Errored driver reported as such.
  assert.match(html, /Similarweb/)
})
