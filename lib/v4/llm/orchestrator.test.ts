/**
 * V4 — LLM insight orchestrator tests (sheets 14/15/16).
 *
 * Run: npx tsx --test lib/v4/llm/orchestrator.test.ts
 *
 * No network, no DB: the Anthropic call is injected (and, in one test,
 * exercised for real against a stubbed globalThis.fetch to verify the
 * per-model parameter differences), Supabase is the same kind of minimal
 * fake the runner tests use, and the spend check is a stub. What gets tested
 * is exactly the behaviour that is invisible from outside: the sequence, the
 * cumulative context, the guardrails, and what lands in the DB when things
 * fail.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyCaps,
  applySummaryCaps,
  clipChars,
  extractJsonObject,
  findInventedNumbers,
  firstSentence,
  generateInsights,
  orderInsightRuns,
  stripEmDashesDeep,
  type InsightRunRow,
  type LlmInsightRecord,
} from './orchestrator'
import type { AnthropicCallOptions, AnthropicCallResult } from '@/lib/v4/drivers/jhorizon-extract'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function irun(key: string, over: Partial<InsightRunRow> = {}): InsightRunRow {
  return {
    id: `run-${key}`,
    driver_key: key,
    enabled: true,
    status: 'done',
    score_absolute: 70,
    score_relative: 62,
    comment_absolute: null,
    comment_relative: null,
    tier_used: null,
    raw_payload: {
      sites: [
        { site_ref: 'client', raw: 12847 },
        { site_ref: 'competitor_1', raw: 20000 },
      ],
    },
    llm_insight: null,
    ...over,
  }
}

function bizOutput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    score_relative: 62,
    commento_relative: 'Il cliente e secondo nel cluster. La dinamica resta stabile nel tempo.',
    insights: [
      {
        titolo: 'Domanda brand sotto il leader del cluster',
        spiegazione:
          'Il volume della domanda branded del cliente resta inferiore al leader del cluster, con una dinamica stabile.',
        rilevanza_strategica: 'alta',
      },
    ],
    ranking_summary: 'Secondo su tre.',
    trend_summary: 'Stabile.',
    ...over,
  }
}

function devOutput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    score_absolute: 70,
    score_relative: 62,
    commento_absolute: 'Profilo tecnico solido nel complesso. Restano margini specifici.',
    commento_relative: 'Sopra la media del set analizzato. Il leader mantiene un vantaggio.',
    items: [
      {
        titolo: 'Profilo backlink concentrato su pochi domini',
        spiegazione: 'Una parte rilevante dei referring domain proviene da un nucleo ristretto di siti.',
        soluzione_proposta: 'Attivare digital PR mirata per ampliare il set di referring domain.',
        priorita: 'alta',
      },
    ],
    priorita_complessiva_driver: 'media',
    competitor_benchmark_summary: 'Secondo nel set.',
    ...over,
  }
}

interface FakeState {
  analysis: Record<string, unknown>
  runs: InsightRunRow[]
  runUpdates: Array<{ id: string; patch: Record<string, unknown> }>
  analysisUpdates: Array<Record<string, unknown>>
  usage: Array<Record<string, unknown>>
  appConfig: Array<{ key: string; value: string }>
}

function makeState(runs: InsightRunRow[], analysisOver: Record<string, unknown> = {}): FakeState {
  return {
    analysis: {
      id: 'analysis-1',
      domain: 'client.com',
      brand_name: 'Client',
      brand_variants: [],
      competitors: ['comp1.com'],
      competitor_details: [],
      ref_date: '2026-06-30',
      industry_preset: 'retail_luxury',
      country: 'IT',
      output_language: 'it',
      user_id: 'user-1',
      client_id: null,
      llm_guardrails: {},
      v4_executive_summary: null,
      v4_insights_status: 'running',
      v4_insights_error: null,
      ...analysisOver,
    },
    runs,
    runUpdates: [],
    analysisUpdates: [],
    usage: [],
    appConfig: [],
  }
}

/** Minimal Supabase fake — same style as runner.test.ts fakeDb. */
function fakeDb(state: FakeState) {
  return {
    from(table: string) {
      if (table === 'analyses') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: state.analysis, error: null }),
              maybeSingle: async () => ({ data: state.analysis, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              state.analysisUpdates.push(patch)
              Object.assign(state.analysis, patch)
              return { error: null }
            },
          }),
        }
      }
      if (table === 'driver_runs') {
        return {
          select: () => ({ eq: async () => ({ data: state.runs, error: null }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              state.runUpdates.push({ id, patch })
              const row = state.runs.find((r) => r.id === id)
              if (row) Object.assign(row, patch)
              return { error: null }
            },
          }),
        }
      }
      if (table === 'app_config') {
        return { select: () => ({ in: async () => ({ data: state.appConfig, error: null }) }) }
      }
      if (table === 'llm_usage') {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.usage.push(row)
            return { error: null }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

interface CapturedCall {
  prompt: string
  what: string
  options?: AnthropicCallOptions
}

/** Captures every prompt; answers from a queue (string or fn-of-prompt). */
function modelStub(responses: Array<string | ((prompt: string) => string)>) {
  const calls: CapturedCall[] = []
  const fn = async (
    prompt: string,
    what: string,
    options?: AnthropicCallOptions,
  ): Promise<AnthropicCallResult> => {
    calls.push({ prompt, what, options })
    const next = responses.shift()
    if (next === undefined) throw new Error('model stub: no response queued for ' + what)
    const text = typeof next === 'function' ? next(prompt) : next
    return { text, model: options?.model ?? 'stub-model', inputTokens: 100, outputTokens: 200 }
  }
  return { fn, calls }
}

const spendOk = async () => ({ blocked: false, limitEur: 10 })
const spendBlocked = async () => ({ blocked: true, limitEur: 10 })

// ---------------------------------------------------------------------------
// pure guardrail helpers
// ---------------------------------------------------------------------------

test('orderInsightRuns: sheet 16 A order, done-only, AI Visibility excluded', () => {
  const rows = [
    irun('speed'), // llmSequence 8
    irun('awareness'), // 1
    irun('ai_visibility'), // null: paste-driven, never in the sequence
    irun('traffic'), // 3
    irun('compliance', { status: 'error' }), // failed: nothing to narrate
    irun('discoverability', { enabled: false }), // disabled: excluded
    irun('authority'), // 4
  ]
  assert.deepEqual(
    orderInsightRuns(rows).map((r) => r.driver_key),
    ['awareness', 'traffic', 'authority', 'speed'],
  )
})

test('extractJsonObject: tolerates fences and preambles, rejects non-objects', () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```').value, { a: 1 })
  assert.deepEqual(extractJsonObject('Here it is: {"a":{"b":2}} thanks').value, { a: { b: 2 } })
  assert.equal(extractJsonObject('no json at all').value, null)
  assert.equal(extractJsonObject('{"broken":').value, null)
  assert.equal(extractJsonObject('[1,2,3]').value, null)
})

test('stripEmDashesDeep: em dashes become commas, everywhere, nothing else touched', () => {
  const scrubbed = stripEmDashesDeep({
    a: 'prima — dopo',
    b: ['x—y', { c: 'senza trattino', n: 42 }],
  })
  assert.deepEqual(scrubbed, { a: 'prima, dopo', b: ['x, y', { c: 'senza trattino', n: 42 }] })
})

test('clipChars / firstSentence: ~100 chars and 1-sentence compression (sheet 16 B)', () => {
  assert.equal(clipChars('breve'), 'breve')
  assert.equal(clipChars('x'.repeat(150)).length, 100)
  assert.equal(firstSentence('Prima frase. Seconda frase.'), 'Prima frase.')
  assert.equal(firstSentence('Nessun punto qui'), 'Nessun punto qui')
})

test('applyCaps: 5 dev items / 3 business insights, guardrail cap can lower', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ titolo: `t${i}` }))
  const dev = applyCaps({ items: many }, 'development')
  assert.equal((dev.items as unknown[]).length, 5)
  const biz = applyCaps({ insights: many }, 'business')
  assert.equal((biz.insights as unknown[]).length, 3)
  const lowered = applyCaps({ items: many }, 'development', 2)
  assert.equal((lowered.items as unknown[]).length, 2)
  const summary = applySummaryCaps({
    correlazioni_chiave: many,
    priorita_strategiche: many,
    alert_critici: many,
  })
  assert.equal((summary.correlazioni_chiave as unknown[]).length, 5)
  assert.equal((summary.alert_critici as unknown[]).length, 3)
})

test('findInventedNumbers: flags numbers >10 absent from the payload, separator-agnostic', () => {
  const payload = JSON.stringify({ pages: 12847, lcp: 4.2, gap: 38 })
  // Cited with the Italian thousands separator: still backed by the payload.
  assert.deepEqual(
    findInventedNumbers({ t: 'errori su 12.847 pagine, gap del 38%' }, [payload]),
    [],
  )
  // Small numbers are never flagged (documented limit: horizons, priorities).
  assert.deepEqual(findInventedNumbers({ t: 'entro 6 mesi, top 10' }, [payload]), [])
  // A number the payload never contained is flagged.
  assert.deepEqual(findInventedNumbers({ t: 'crescita del 99123' }, [payload]), ['99123'])
  // Numeric JSON fields are not scanned, only strings.
  assert.deepEqual(findInventedNumbers({ score: 77777 }, [payload]), [])
})

// ---------------------------------------------------------------------------
// the engine
// ---------------------------------------------------------------------------

test('engine: sequence order, cumulative context growth, AI Visibility seed, summary inputs', async () => {
  const state = makeState([
    irun('authority'), // llmSequence 4 — listed first to prove sorting
    irun('awareness', { score_relative: 40 }), // 1
    irun('discoverability', { tier_used: 'relaxed_2', score_relative: 55 }), // 2
    irun('ai_visibility', {
      score_relative: 45,
      comment_relative:
        'AI Visibility debole rispetto ai competitor del cluster. La presenza nelle risposte AI resta marginale.',
    }),
  ])

  const stub = modelStub([
    JSON.stringify(bizOutput({ insights: [{ titolo: 'Titolo awareness uno', spiegazione: 'Spiegazione awareness.', rilevanza_strategica: 'alta' }] })),
    JSON.stringify(bizOutput({ insights: [{ titolo: 'Titolo discoverability due', spiegazione: 'Spiegazione discoverability.', rilevanza_strategica: 'media' }] })),
    JSON.stringify(devOutput()),
    JSON.stringify({
      headline_dominante: 'Sintesi di test.',
      scorecard_overview: 'Quadro generale coerente con gli score.',
      correlazioni_chiave: [],
      priorita_strategiche: [],
      alert_critici: [],
    }),
  ])

  const result = await generateInsights(fakeDb(state), 'analysis-1', {
    callModel: stub.fn,
    spendStatus: spendOk,
  })

  assert.equal(result.status, 'done')
  assert.equal(result.completed, true)
  assert.deepEqual(result.processed, ['awareness', 'discoverability', 'authority'])

  // Sheet 16 A: strictly the registry llmSequence order, then the summary.
  assert.deepEqual(
    stub.calls.map((c) => c.what),
    ['V4 insight Awareness', 'V4 insight Discoverability', 'V4 insight Authority', 'V4 Executive Summary'],
  )

  // Sheet 16 B: AI Visibility's relative comment seeds the context of call 1.
  assert.match(stub.calls[0].prompt, /AI Visibility debole rispetto ai competitor/)

  // Cumulative growth: call 2 sees call 1's title; call 3 sees both.
  assert.match(stub.calls[1].prompt, /Titolo awareness uno/)
  assert.match(stub.calls[2].prompt, /Titolo awareness uno/)
  assert.match(stub.calls[2].prompt, /Titolo discoverability due/)
  assert.doesNotMatch(stub.calls[0].prompt, /Titolo awareness uno/)

  // System prompt variant per family (sheet 15 B).
  assert.match(stub.calls[0].options?.system ?? '', /QUALITATIVE and DIRECTIONAL/)
  assert.match(stub.calls[2].options?.system ?? '', /soluzione_proposta/)

  // Discoverability transparency: the relaxed tier is spelled out (sheet 14).
  assert.match(stub.calls[1].prompt, /top 20 with volume >= 500 \(relaxed_2\)/)

  // Models and parameters: sonnet default per driver, opus 4.8 for the summary.
  assert.equal(stub.calls[0].options?.model, 'claude-sonnet-5')
  assert.equal(stub.calls[3].options?.model, 'claude-opus-4-8')
  assert.equal(stub.calls[3].options?.maxTokens, 4000)
  assert.equal(stub.calls[3].options?.temperature, 0.4)
  assert.equal(stub.calls[0].options?.maxTokens, 2500)

  // The summary receives every driver output + the AI Visibility comments.
  assert.match(stub.calls[3].prompt, /Titolo awareness uno/)
  assert.match(stub.calls[3].prompt, /Profilo backlink concentrato/)
  assert.match(stub.calls[3].prompt, /AI Visibility debole/)

  // Persistence: one llm_insight per driver, written as it landed.
  const insightWrites = state.runUpdates.filter((u) => u.patch.llm_insight)
  assert.deepEqual(
    insightWrites.map((u) => u.id),
    ['run-awareness', 'run-discoverability', 'run-authority'],
  )
  const summary = state.analysis.v4_executive_summary as LlmInsightRecord
  assert.equal(summary.status, 'done')
  assert.equal(summary.model, 'claude-opus-4-8')
  assert.equal(state.analysis.v4_insights_status, 'done')
  assert.equal(state.analysis.v4_insights_error, null)

  // Every call logged with its distinct label.
  assert.deepEqual(
    state.usage.map((u) => u.operation),
    [
      'v4_driver_insight_awareness',
      'v4_driver_insight_discoverability',
      'v4_driver_insight_authority',
      'v4_executive_summary',
    ],
  )
  assert.equal(state.usage[0].user_id, 'user-1')
})

test('engine: invalid JSON retries with guidance, then succeeds (sheet 15 A)', async () => {
  const state = makeState([irun('authority')])
  const stub = modelStub([
    'sorry, here is some prose without JSON',
    JSON.stringify(devOutput()),
    JSON.stringify({ headline_dominante: 'ok', scorecard_overview: 'ok', correlazioni_chiave: [], priorita_strategiche: [], alert_critici: [] }),
  ])

  const result = await generateInsights(fakeDb(state), 'analysis-1', {
    callModel: stub.fn,
    spendStatus: spendOk,
  })

  assert.equal(result.status, 'done')
  assert.equal(stub.calls.length, 3)
  assert.match(stub.calls[1].prompt, /YOUR PREVIOUS RESPONSE WAS REJECTED/)
  const insight = state.runs[0].llm_insight
  assert.equal(insight?.status, 'done')
  assert.equal(insight?.attempts, 2)
})

test('engine: JSON never parses -> per-driver error persisted, run continues to done with warning', async () => {
  const state = makeState([irun('authority')], {
    // A stored summary keeps this test on the driver path only.
    v4_executive_summary: { status: 'done', output: {}, model: 'x', generated_at: 'y', attempts: 1 },
  })
  const stub = modelStub(['nope', 'still nope', 'never json'])

  const result = await generateInsights(fakeDb(state), 'analysis-1', {
    callModel: stub.fn,
    spendStatus: spendOk,
  })

  assert.equal(stub.calls.length, 3) // 1 + max 2 retries, then alert (sheet 15 A)
  assert.equal(result.status, 'done')
  assert.equal(result.failed.length, 1)
  assert.equal(state.runs[0].llm_insight?.status, 'error')
  assert.match(String(state.analysis.v4_insights_error), /authority/)
})

test('engine: em dashes are replaced in the persisted output, never a retry reason', async () => {
  const state = makeState([irun('authority')])
  const dashed = devOutput({
    commento_relative: 'Sopra la media — ma il leader resta lontano.',
  })
  const stub = modelStub([
    JSON.stringify(dashed),
    JSON.stringify({ headline_dominante: 'ok', scorecard_overview: 'ok', correlazioni_chiave: [], priorita_strategiche: [], alert_critici: [] }),
  ])

  await generateInsights(fakeDb(state), 'analysis-1', { callModel: stub.fn, spendStatus: spendOk })

  const insight = state.runs[0].llm_insight
  assert.equal(insight?.status, 'done')
  assert.equal(insight?.attempts, 1) // no retry burned on a cosmetic fix
  const output = (insight as { output: Record<string, unknown> }).output
  assert.equal(output.commento_relative, 'Sopra la media, ma il leader resta lontano.')
})

test('engine: an invented number triggers a guided retry; if it persists it is flagged, not hidden', async () => {
  const state = makeState([irun('authority')])
  const inventing = devOutput({
    commento_relative: 'Il profilo mostra una crescita del 99123 per cento.',
  })
  const stub = modelStub([
    JSON.stringify(inventing),
    JSON.stringify(devOutput()), // corrected on retry
    JSON.stringify({ headline_dominante: 'ok', scorecard_overview: 'ok', correlazioni_chiave: [], priorita_strategiche: [], alert_critici: [] }),
  ])

  await generateInsights(fakeDb(state), 'analysis-1', { callModel: stub.fn, spendStatus: spendOk })
  assert.match(stub.calls[1].prompt, /99123/)
  assert.match(stub.calls[1].prompt, /do not exist in the data/)
  assert.equal(state.runs[0].llm_insight?.status, 'done')
  assert.equal(
    (state.runs[0].llm_insight as { hallucination_flags?: string[] }).hallucination_flags,
    undefined,
  )

  // Same setup, but the model never corrects itself: FLAG mode (sheet 14).
  const state2 = makeState([irun('authority')], {
    v4_executive_summary: { status: 'done', output: {}, model: 'x', generated_at: 'y', attempts: 1 },
  })
  const stub2 = modelStub([
    JSON.stringify(inventing),
    JSON.stringify(inventing),
    JSON.stringify(inventing),
  ])
  await generateInsights(fakeDb(state2), 'analysis-1', { callModel: stub2.fn, spendStatus: spendOk })
  const flagged = state2.runs[0].llm_insight as { status: string; hallucination_flags?: string[]; attempts: number }
  assert.equal(flagged.status, 'done')
  assert.deepEqual(flagged.hallucination_flags, ['99123'])
  assert.equal(flagged.attempts, 3)
})

test('engine: a stored insight is skipped (idempotent resume) but still feeds the context', async () => {
  const stored: LlmInsightRecord = {
    status: 'done',
    output: bizOutput({
      insights: [{ titolo: 'Titolo gia persistito', spiegazione: 'Da un run precedente.', rilevanza_strategica: 'alta' }],
    }),
    model: 'claude-sonnet-5',
    generated_at: '2026-08-11T00:00:00.000Z',
    attempts: 1,
  }
  const state = makeState([
    irun('awareness', { llm_insight: stored }),
    irun('authority'),
  ])
  const stub = modelStub([
    JSON.stringify(devOutput()),
    JSON.stringify({ headline_dominante: 'ok', scorecard_overview: 'ok', correlazioni_chiave: [], priorita_strategiche: [], alert_critici: [] }),
  ])

  const result = await generateInsights(fakeDb(state), 'analysis-1', {
    callModel: stub.fn,
    spendStatus: spendOk,
  })

  assert.deepEqual(result.skippedExisting, ['awareness'])
  assert.deepEqual(result.processed, ['authority'])
  // No regeneration for awareness: first call is already Authority.
  assert.equal(stub.calls[0].what, 'V4 insight Authority')
  // ...but the stored titles still reach the anti-redundancy context.
  assert.match(stub.calls[0].prompt, /Titolo gia persistito/)
  // And the stored output still reaches the Executive Summary.
  assert.match(stub.calls[1].prompt, /Titolo gia persistito/)
})

test('engine: spend limit blocked -> status error with the reason, zero model calls', async () => {
  const state = makeState([irun('authority')])
  const stub = modelStub([])

  const result = await generateInsights(fakeDb(state), 'analysis-1', {
    callModel: stub.fn,
    spendStatus: spendBlocked,
  })

  assert.equal(result.status, 'error')
  assert.equal(result.completed, true)
  assert.equal(stub.calls.length, 0)
  assert.equal(state.analysis.v4_insights_status, 'error')
  assert.match(String(state.analysis.v4_insights_error), /limite di spesa/)
})

test('engine: exhausted budget returns next:true without touching the terminal status', async () => {
  const state = makeState([irun('authority')])
  const stub = modelStub([])

  const result = await generateInsights(fakeDb(state), 'analysis-1', {
    callModel: stub.fn,
    spendStatus: spendOk,
    budgetMs: -1, // force "no time left" before the first call
  })

  assert.deepEqual(
    { completed: result.completed, next: result.next, status: result.status },
    { completed: false, next: true, status: 'running' },
  )
  assert.equal(stub.calls.length, 0)
  assert.equal(state.analysis.v4_insights_status, 'running') // untouched
})

test('engine: app_config overrides the models (v4_llm_driver_model / v4_llm_summary_model)', async () => {
  const state = makeState([irun('authority')])
  state.appConfig = [
    { key: 'v4_llm_driver_model', value: 'claude-sonnet-4-6' },
    { key: 'v4_llm_summary_model', value: 'claude-opus-4-7' },
  ]
  const stub = modelStub([
    JSON.stringify(devOutput()),
    JSON.stringify({ headline_dominante: 'ok', scorecard_overview: 'ok', correlazioni_chiave: [], priorita_strategiche: [], alert_critici: [] }),
  ])

  await generateInsights(fakeDb(state), 'analysis-1', { callModel: stub.fn, spendStatus: spendOk })
  assert.equal(stub.calls[0].options?.model, 'claude-sonnet-4-6')
  assert.equal(stub.calls[1].options?.model, 'claude-opus-4-7')
})

test('engine: real Anthropic wire format — no temperature for sonnet-5, 0.4 for the opus summary', async () => {
  // Goes through callAnthropicWithUsage for real, with fetch stubbed: this is
  // the one place the "sonnet-5 rejects temperature" rule can regress.
  const state = makeState([irun('authority')])
  const bodies: Array<Record<string, unknown>> = []
  const answers = [
    JSON.stringify(devOutput()),
    JSON.stringify({ headline_dominante: 'ok', scorecard_overview: 'ok', correlazioni_chiave: [], priorita_strategiche: [], alert_critici: [] }),
  ]

  const originalFetch = globalThis.fetch
  const originalKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'test-key'
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    bodies.push(body)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ text: answers.shift() ?? '{}' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    } as Response
  }) as typeof fetch

  try {
    const result = await generateInsights(fakeDb(state), 'analysis-1', { spendStatus: spendOk })
    assert.equal(result.status, 'done')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  }

  assert.equal(bodies.length, 2)
  assert.equal(bodies[0].model, 'claude-sonnet-5')
  assert.ok(!('temperature' in bodies[0]), 'sonnet-5 must not receive temperature (commit #42)')
  assert.equal(bodies[0].max_tokens, 2500)
  assert.equal(bodies[1].model, 'claude-opus-4-8')
  assert.equal(bodies[1].temperature, 0.4)
  assert.equal(bodies[1].max_tokens, 4000)
  assert.ok(typeof bodies[0].system === 'string' && (bodies[0].system as string).length > 0)
})
