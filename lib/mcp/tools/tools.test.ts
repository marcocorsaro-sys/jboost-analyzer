/**
 * MCP tool registry tests — pure: route handlers and the audit source are
 * replaced with fakes, so nothing imports Next, Supabase or the runner.
 * Run: npx tsx --test lib/mcp/tools/tools.test.ts
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { McpToolError, type McpTool, type McpToolContext } from '@/lib/mcp/types'
import type { RouteHandler } from '@/lib/mcp/call-route'
import { MCP_TOOLS, getMcpTool } from '@/lib/mcp/tools'
import { routes, sources, type RouteName } from '@/lib/mcp/tools/routes'
import { SetupBody } from '@/lib/v4/setup-request'
import { trimJson, TEXT_TRIM } from '@/lib/mcp/tools/shared'
import type { AuditListItem } from '@/lib/v4/audits'

const AUDIT = '3f1c2b4e-8a6d-4c1e-9b7f-0a1b2c3d4e5f'
const CLIENT = '9a8b7c6d-1111-4222-8333-444455556666'
const ctx: McpToolContext = { userId: 'u1', email: 'a@b.it', origin: 'https://jboost.test' }

const READ_ONLY = new Set([
  'list_audits',
  'get_audit',
  'get_driver',
  'get_insights',
  'get_controller',
  'list_clients',
  'get_client',
  'get_driver_catalog',
])
const WRITE = [
  'create_audit',
  'start_audit',
  'rerun_drivers',
  'generate_insights',
  'resolve_decision',
  'set_global_notes',
  'publish_audit',
]

const tool = (name: string): McpTool => {
  const t = getMcpTool(name)
  assert.ok(t, `tool ${name} is registered`)
  return t
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// ---------------------------------------------------------------------------
// Fake routes: record every call, restore the real loaders after each test.
// ---------------------------------------------------------------------------

interface Recorded {
  route: RouteName
  method: string
  url: string
  body: unknown
}
let calls: Recorded[] = []
const originalRoutes = { ...routes }
const originalAudits = sources.audits
const originalByCode = sources.auditIdByCode

function fakeRoute(
  name: RouteName,
  respond: (body: unknown, request: Request, context: { params: unknown }) => Response | Promise<Response>,
): void {
  const handler: RouteHandler = async (request, context) => {
    const text = await request.text()
    const body = text ? (JSON.parse(text) as unknown) : undefined
    calls.push({ route: name, method: request.method, url: request.url, body })
    return respond(body, request, context as unknown as { params: unknown })
  }
  routes[name] = async () => handler
}

beforeEach(() => {
  calls = []
})
afterEach(() => {
  Object.assign(routes, originalRoutes)
  sources.audits = originalAudits
  sources.auditIdByCode = originalByCode
})

const callsTo = (route: RouteName): Recorded[] => calls.filter((c) => c.route === route)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATUS = {
  analysisId: AUDIT,
  refDate: '2026-10-31',
  domain: 'acme.it',
  brandName: 'Acme',
  industryPreset: 'retail_luxury',
  country: 'IT',
  clientId: null,
  globalNotes: 'Focus on PLP',
  sites: [
    { site_ref: 'client', domain: 'acme.it', name: 'Acme', is_client: true },
    { site_ref: 'competitor_1', domain: 'rival.it', name: 'Rival', is_client: false },
  ],
  progress: { total: 4, done: 2, error: 1, needs_decision: 1, pending: 0, complete: false },
  drivers: [
    {
      driver_key: 'speed',
      status: 'error',
      enabled: true,
      raw_value: null,
      score_absolute: null,
      score_relative: null,
      error: 'PSI quota exceeded',
      attempts: 3,
      max_attempts: 3,
      raw_payload: { HUGE_RAW: 'x'.repeat(10_000) },
      sites: [],
      unmeasured_details: [],
      attachments: [],
      decision_request: null,
    },
    {
      driver_key: 'traffic',
      status: 'done',
      enabled: true,
      raw_value: 120000,
      score_absolute: null,
      score_relative: 100,
      comment_relative: 'Leader of the set.',
      attempts: 1,
      max_attempts: 3,
      partial_note: 'misurato 1 sito su 2',
      sites: [
        {
          site_ref: 'client',
          domain: 'acme.it',
          raw: 120000,
          score_relative: 100,
          rank: 1,
          evidence: { monthly_visits: Array.from({ length: 40 }, (_, i) => ({ month: i, visits: i * 10 })) },
        },
        { site_ref: 'competitor_1', domain: 'rival.it', raw: null, score_relative: null, rank: null },
      ],
      unmeasured_details: [{ domain: 'rival.it', reason: 'no Similarweb data' }],
      attachments: [{ kind: 'backlinks', path: 'u/a.csv', secret: 'dropme' }],
      decision_request: null,
    },
    {
      driver_key: 'discoverability',
      status: 'needs_decision',
      enabled: true,
      raw_value: null,
      score_absolute: null,
      score_relative: null,
      sites: [],
      unmeasured_details: [],
      attachments: [],
      decision_request: {
        reason: 'empty_tier',
        tier: 'strict',
        options: ['remove', 'replace', 'extend'],
        next_tier: 'relaxed_2',
        empty_players: ['rival.it'],
        message: 'rival.it non ha keyword nel tier "strict"',
        copy_prompt: 'LONG PROMPT '.repeat(500),
      },
    },
    {
      driver_key: 'awareness',
      status: 'done',
      enabled: true,
      raw_value: 55,
      score_absolute: null,
      score_relative: 80,
      sites: [],
      unmeasured_details: [],
      attachments: [],
      decision_request: null,
    },
  ],
}

const SAVED_SETUP = {
  analysisId: AUDIT,
  setup: {
    domain: 'acme.it',
    brandName: 'Acme',
    country: 'IT',
    countries: ['IT'],
    outputLanguage: 'it',
    siteType: 'ecommerce',
    competitors: [{ domain: 'rival.it', brandName: 'Rival' }],
    enabledDrivers: ['speed', 'compliance'],
    thematicClusters: [],
    blocklist: [],
    templates: { client: { homepage: 'https://acme.it' } },
  },
}

const INSIGHTS = {
  analysisId: AUDIT,
  insightsStatus: 'done',
  insightsError: null,
  executiveSummary: {
    status: 'done',
    model: 'claude',
    generated_at: '2026-10-31T10:00:00Z',
    attempts: 1,
    output: { correlazioni_chiave: [{ titolo: 'A', spiegazione: 'B' }] },
  },
  drivers: [
    {
      driver_key: 'traffic',
      status: 'done',
      llm_sequence: 3,
      insight: {
        status: 'done',
        model: 'claude',
        generated_at: 't',
        attempts: 1,
        hallucination_flags: ['12%'],
        output: { commento_relative: 'y'.repeat(5000), insights: [{ titolo: 'T', spiegazione: 'S' }] },
      },
    },
    {
      driver_key: 'awareness',
      status: 'done',
      llm_sequence: 1,
      insight: { status: 'error', error: 'timeout', model: 'claude', generated_at: 't', attempts: 2 },
    },
    { driver_key: 'speed', status: 'error', llm_sequence: 9, insight: null },
  ],
}

const auditItem = (over: Partial<AuditListItem>): AuditListItem => ({
  id: AUDIT,
  name: 'Acme',
  domain: 'acme.it',
  createdAt: '2026-10-30T09:00:00Z',
  refDate: '2026-10-31',
  state: 'running',
  overallScore: 90,
  driversDone: 2,
  driversTotal: 4,
  driversNeedsDecision: 1,
  driversError: 1,
  competitors: ['rival.it'],
  started: true,
  clientId: null,
  code: 'JBA-0020',
  jhOrganizationId: null,
  ...over,
})

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

test('registry: exactly the 15 expected tools, unique snake_case names', () => {
  const names = MCP_TOOLS.map((t) => t.name)
  assert.equal(new Set(names).size, names.length)
  assert.deepEqual([...names].sort(), [...READ_ONLY, ...WRITE].sort())
  for (const name of names) assert.match(name, /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/)
})

test('registry: readOnly flags, descriptions, titles and object input schemas', () => {
  for (const t of MCP_TOOLS) {
    assert.equal(t.readOnly, READ_ONLY.has(t.name), `${t.name} readOnly`)
    assert.ok(t.title.trim().length > 0, `${t.name} title`)
    assert.ok(t.description.trim().length > 40, `${t.name} description`)
    assert.equal(t.inputSchema.type, 'object', `${t.name} schema type`)
    assert.equal(typeof t.run, 'function')
  }
})

test('registry: write tools say what they cost and that approval is asked', () => {
  for (const name of WRITE) {
    const d = tool(name).description
    assert.match(d, /Cost:/, `${name} states its cost`)
    assert.match(d, /asked to approve/, `${name} mentions approval`)
  }
})

test('registry: every schema property has a description and required keys exist', () => {
  for (const t of MCP_TOOLS) {
    const props = (t.inputSchema.properties ?? {}) as Record<string, { description?: string }>
    for (const [key, def] of Object.entries(props)) {
      assert.ok(def.description && def.description.length > 3, `${t.name}.${key} has a description`)
    }
    for (const req of (t.inputSchema.required ?? []) as string[]) {
      assert.ok(req in props, `${t.name} requires ${req} which is declared`)
    }
  }
})

test('registry: create_audit JSON schema mirrors every SetupBody field (drift guard)', () => {
  const setup = (tool('create_audit').inputSchema.properties as Record<string, { properties: Record<string, unknown> }>).setup
  const zodKeys = Object.keys(SetupBody.shape).filter((k) => k !== 'mode').sort()
  assert.deepEqual(Object.keys(setup.properties).sort(), zodKeys)
})

test('getMcpTool finds by name and returns undefined otherwise', () => {
  assert.equal(getMcpTool('list_audits')?.name, 'list_audits')
  assert.equal(getMcpTool('nope'), undefined)
})

// ---------------------------------------------------------------------------
// Argument validation: the model gets a clear message
// ---------------------------------------------------------------------------

const AUDIT_SCOPED = MCP_TOOLS.filter((t) => ((t.inputSchema.required ?? []) as string[]).includes('audit_id'))

test('validation: every audit-scoped tool rejects a missing and a non-UUID audit_id', async () => {
  assert.ok(AUDIT_SCOPED.length >= 10)
  for (const t of AUDIT_SCOPED) {
    const extra = t.name === 'get_driver' || t.name === 'resolve_decision' ? { driver: 'speed', decision: { tier: 'relaxed_2' } } : {}
    const extra2 = t.name === 'set_global_notes' ? { notes: 'x' } : {}
    await assert.rejects(
      t.run({ ...extra, ...extra2 }, ctx),
      (err: unknown) => err instanceof McpToolError && /audit_id is required/.test(err.message),
      `${t.name} missing audit_id`,
    )
    await assert.rejects(
      t.run({ ...extra, ...extra2, audit_id: 'not-a-uuid' }, ctx),
      (err: unknown) => err instanceof McpToolError && /audit_id must be a project code such as JBA-0020 or a UUID/.test(err.message),
      `${t.name} non-UUID audit_id`,
    )
  }
  assert.equal(calls.length, 0, 'no route is called for invalid arguments')
})

test('project code: audit-scoped tools accept JBA-NNNN and resolve it to the UUID before running', async () => {
  const asked: string[] = []
  sources.auditIdByCode = async (code) => {
    asked.push(code)
    return code === 'JBA-0020' ? AUDIT : null
  }
  fakeRoute('status', () => json(STATUS))
  fakeRoute('analysisGet', () => json({ analysisId: AUDIT, setup: {} }))
  for (const typed of ['JBA-0020', 'jba-20', ' JBA0020 ']) {
    const { data } = await tool('get_audit').run({ audit_id: typed }, ctx)
    assert.equal((data as { audit_id: string }).audit_id, AUDIT, typed)
  }
  assert.deepEqual(asked, ['JBA-0020', 'JBA-0020', 'JBA-0020'])
  assert.ok(callsTo('status').every((c) => c.url.includes(AUDIT)), 'the route sees the UUID, never the code')
  await assert.rejects(
    tool('get_audit').run({ audit_id: 'JBA-0999' }, ctx),
    (e: unknown) => e instanceof McpToolError && /No audit with project code JBA-0999/.test(e.message),
  )
  // A UUID skips the lookup altogether.
  asked.length = 0
  await tool('get_audit').run({ audit_id: AUDIT }, ctx)
  assert.equal(asked.length, 0)
})

test('project code: schemas advertise the code, usage log never gets a code as analysis id', () => {
  for (const t of AUDIT_SCOPED) {
    const prop = (t.inputSchema.properties as Record<string, Record<string, unknown>>).audit_id
    assert.equal(prop.format, undefined, `${t.name} no longer claims uuid-only`)
    assert.match(String(prop.description), /JBA-0020/, t.name)
    assert.equal(t.analysisIdOf?.({ audit_id: 'JBA-0020' }), null, t.name)
  }
})

test('list_audits returns code and jhOrganizationId and matches the code in query', async () => {
  sources.audits = async () => [
    auditItem({ code: 'JBA-0020', jhOrganizationId: 'm1798kc33zpbte60wwgpq1v1md8haxkn' }),
    auditItem({ id: '55555555-5555-4555-8555-555555555555', name: 'Altro', domain: 'altro.it', code: 'JBA-0021', competitors: [] }),
  ]
  const r = (await tool('list_audits').run({ query: 'jba-0021' }, ctx)).data as {
    audits: Array<{ code: string; jhOrganizationId: string | null }>
  }
  assert.deepEqual(r.audits.map((a) => a.code), ['JBA-0021'])
  const all = (await tool('list_audits').run({}, ctx)).data as { audits: Array<{ code: string; jhOrganizationId: string | null }> }
  assert.equal(all.audits[0].jhOrganizationId, 'm1798kc33zpbte60wwgpq1v1md8haxkn')
})

test('validation: analysisIdOf extracts audit_id for audit-scoped tools only', () => {
  for (const t of AUDIT_SCOPED) assert.equal(t.analysisIdOf?.({ audit_id: AUDIT, driver: 'speed' }), AUDIT, t.name)
  assert.equal(tool('get_audit').analysisIdOf?.(null), null)
  assert.equal(tool('get_audit').analysisIdOf?.({ audit_id: 5 }), null)
  assert.equal(tool('create_audit').analysisIdOf, undefined)
})

test('validation: driver keys, decision, notes, mode and unknown setup fields are checked', async () => {
  await assert.rejects(
    tool('get_driver').run({ audit_id: AUDIT, driver: 'seo' }, ctx),
    (e: unknown) => e instanceof McpToolError && /driver must be one of: awareness, ai_visibility/.test(e.message),
  )
  await assert.rejects(
    tool('start_audit').run({ audit_id: AUDIT, drivers: [] }, ctx),
    (e: unknown) => e instanceof McpToolError && /at least one driver/.test(e.message),
  )
  await assert.rejects(
    tool('start_audit').run({ audit_id: AUDIT, drivers: ['speed', 'speed'] }, ctx),
    (e: unknown) => e instanceof McpToolError && /must not repeat/.test(e.message),
  )
  await assert.rejects(
    tool('rerun_drivers').run({ audit_id: AUDIT, drivers: ['speed'], jhorizon_answer: 'text' }, ctx),
    (e: unknown) => e instanceof McpToolError && /only accepted together with drivers/.test(e.message),
  )
  await assert.rejects(
    tool('resolve_decision').run({ audit_id: AUDIT, driver: 'discoverability', decision: {} }, ctx),
    (e: unknown) => e instanceof McpToolError && /empty decision/.test(e.message),
  )
  await assert.rejects(
    tool('set_global_notes').run({ audit_id: AUDIT }, ctx),
    (e: unknown) => e instanceof McpToolError && /notes is required/.test(e.message),
  )
  await assert.rejects(
    tool('create_audit').run({ mode: 'maybe', setup: { client: { domain: 'a.it' } } }, ctx),
    (e: unknown) => e instanceof McpToolError && /mode must be 'draft' or 'launch'/.test(e.message),
  )
  await assert.rejects(
    tool('create_audit').run({ mode: 'draft', setup: { client: { domain: 'a.it', brand_name: 'A' } } }, ctx),
    (e: unknown) => e instanceof McpToolError && /Unrecognized key/.test(e.message),
  )
  await assert.rejects(
    tool('get_client').run({ client_id: 'x' }, ctx),
    (e: unknown) => e instanceof McpToolError && /client_id must be a UUID/.test(e.message),
  )
  await assert.rejects(
    tool('list_audits').run({ limit: 500 }, ctx),
    (e: unknown) => e instanceof McpToolError && /Invalid arguments for list_audits/.test(e.message),
  )
  assert.equal(calls.length, 0)
})

// ---------------------------------------------------------------------------
// get_driver_catalog (pure)
// ---------------------------------------------------------------------------

test('get_driver_catalog returns the 10 drivers, Business first, plus the scoring note', async () => {
  const { data, isError } = await tool('get_driver_catalog').run({}, ctx)
  assert.ok(!isError)
  const out = data as { drivers: Array<Record<string, unknown>>; scoring: string }
  assert.equal(out.drivers.length, 10)
  assert.deepEqual(
    out.drivers.slice(0, 4).map((d) => d.key),
    ['awareness', 'ai_visibility', 'discoverability', 'traffic'],
  )
  assert.ok(out.drivers.slice(0, 4).every((d) => d.family === 'business' && d.competitorMandatory === true))
  for (const d of out.drivers) {
    for (const k of ['key', 'label', 'family', 'competitorMandatory', 'hasAbsoluteView', 'source']) assert.ok(k in d, k)
  }
  assert.match(out.scoring, /Leader Index/)
})

// ---------------------------------------------------------------------------
// Read tools against fake routes
// ---------------------------------------------------------------------------

test('get_audit composes status + saved setup into one compact answer', async () => {
  fakeRoute('status', () => json(STATUS))
  fakeRoute('analysisGet', () => json(SAVED_SETUP))
  const { data } = await tool('get_audit').run({ audit_id: AUDIT }, ctx)
  const out = data as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- test-only digging

  assert.equal(out.audit_id, AUDIT)
  assert.equal(out.name, 'Acme')
  assert.equal(out.globalNotes, 'Focus on PLP')
  assert.equal(out.started, true)
  assert.equal(out.overallScore, 90) // mean of the two done drivers (100, 80)
  assert.deepEqual(out.setup.enabledDrivers, ['speed', 'compliance'])
  // Registry display order: Business first.
  assert.deepEqual(
    out.drivers.map((d: { driver: string }) => d.driver),
    ['awareness', 'discoverability', 'traffic', 'speed'],
  )

  const speed = out.drivers.find((d: { driver: string }) => d.driver === 'speed')
  assert.equal(speed.failureReason, 'PSI quota exceeded')
  assert.equal(speed.scoreRelative, null)

  const disc = out.drivers.find((d: { driver: string }) => d.driver === 'discoverability')
  assert.equal(disc.status, 'needs_decision')
  assert.deepEqual(disc.decisionRequest.options, ['remove', 'replace', 'extend'])
  assert.equal(disc.decisionRequest.copy_prompt, undefined, 'long prompt stays out of the overview')

  const traffic = out.drivers.find((d: { driver: string }) => d.driver === 'traffic')
  assert.equal(traffic.partialNote, 'misurato 1 sito su 2')
  assert.deepEqual(traffic.unmeasured, [{ domain: 'rival.it', reason: 'no Similarweb data' }])

  assert.equal(JSON.stringify(out).includes('HUGE_RAW'), false, 'raw payload blobs never leak')
  // Both routes were called with the audit id as the params and the synthetic origin.
  assert.ok(callsTo('status')[0].url.startsWith('https://jboost.test/api/v4/analyses/'))
})

test('get_audit surfaces a route failure as McpToolError', async () => {
  fakeRoute('status', () => json({ error: 'analysis not found or no access' }, 404))
  fakeRoute('analysisGet', () => json({ error: 'analysis not found or no access' }, 404))
  await assert.rejects(
    tool('get_audit').run({ audit_id: AUDIT }, ctx),
    (e: unknown) => e instanceof McpToolError && /analysis not found or no access \(HTTP 404\)/.test(e.message),
  )
})

test('get_driver returns per-site values, trimmed evidence, the insight and flags truncation', async () => {
  fakeRoute('status', () => json(STATUS))
  fakeRoute('insightsGet', () => json(INSIGHTS))
  const { data } = await tool('get_driver').run({ audit_id: AUDIT, driver: 'traffic' }, ctx)
  const out = data as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- test-only digging

  assert.equal(out.driver, 'traffic')
  assert.equal(out.scoreRelative, 100)
  assert.equal(out.sites.length, 2)
  assert.equal(out.sites[0].rank, 1)
  const visits = out.sites[0].evidence.monthly_visits as unknown[]
  assert.equal(visits.length, 9, '8 kept + 1 marker')
  assert.match(String(visits[8]), /\+32 more items/)
  assert.equal(out.truncated, true)
  assert.ok(out.hint)
  assert.deepEqual(out.attachments, [{ kind: 'backlinks', path: 'u/a.csv' }])
  assert.equal(out.insight.status, 'done')
  assert.deepEqual(out.insight.hallucinationFlags, ['12%'])
  assert.ok((out.insight.output.commento_relative as string).length < 1700, 'long insight text is clipped')
})

test('get_driver keeps the full decision request of a paused driver', async () => {
  fakeRoute('status', () => json(STATUS))
  fakeRoute('insightsGet', () => json({ error: 'boom' }, 500))
  const { data } = await tool('get_driver').run({ audit_id: AUDIT, driver: 'discoverability' }, ctx)
  const out = data as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- test-only digging
  assert.equal(out.status, 'needs_decision')
  assert.equal(out.decisionRequest.next_tier, 'relaxed_2')
  assert.match(out.decisionRequest.copy_prompt, /LONG PROMPT/)
  assert.equal(out.insight, null, 'a failing insights route does not hide the measurement')
})

test('get_driver says so when the driver has no run', async () => {
  fakeRoute('status', () => json({ ...STATUS, drivers: [] }))
  fakeRoute('insightsGet', () => json(INSIGHTS))
  await assert.rejects(
    tool('get_driver').run({ audit_id: AUDIT, driver: 'authority' }, ctx),
    (e: unknown) => e instanceof McpToolError && /has no run in this audit/.test(e.message),
  )
})

test('get_insights orders by LLM sequence, keeps error records and clips long text', async () => {
  fakeRoute('insightsGet', () => json(INSIGHTS))
  const { data } = await tool('get_insights').run({ audit_id: AUDIT }, ctx)
  const out = data as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- test-only digging
  assert.equal(out.insightsStatus, 'done')
  assert.deepEqual(
    out.drivers.map((d: { driver: string }) => d.driver),
    ['awareness', 'traffic', 'speed'],
  )
  assert.equal(out.drivers[0].insight.status, 'error')
  assert.equal(out.drivers[0].insight.error, 'timeout')
  assert.equal(out.drivers[2].insight, null)
  assert.equal(out.executiveSummary.output.correlazioni_chiave[0].titolo, 'A')
  assert.equal(out.truncated, true)
})

test('get_controller caps findings at 50 and reports the cut', async () => {
  const findings = Array.from({ length: 60 }, (_, i) => ({
    severity: 'warning',
    check: 'stuck_job',
    driver_key: 'speed',
    message: `finding ${i}`,
  }))
  fakeRoute('controllerGet', () => json({ findings, counts: { error: 0, warning: 60, info: 0 }, checked_at: 'now' }))
  const { data } = await tool('get_controller').run({ audit_id: AUDIT }, ctx)
  const out = data as { findings: unknown[]; truncated: boolean; counts: { warning: number } }
  assert.equal(out.findings.length, 50)
  assert.equal(out.truncated, true)
  assert.equal(out.counts.warning, 60)
})

test('list_audits filters by query, caps rows and flags truncation', async () => {
  sources.audits = async () => [
    auditItem({ id: AUDIT, name: 'Acme', domain: 'acme.it' }),
    auditItem({ id: '11111111-1111-4111-8111-111111111111', name: 'Beta', domain: 'beta.com', competitors: ['acme.it'] }),
    auditItem({ id: '22222222-2222-4222-8222-222222222222', name: 'Gamma', domain: 'gamma.org', competitors: [] }),
  ]
  const all = (await tool('list_audits').run({}, ctx)).data as { audits: unknown[]; truncated?: boolean }
  assert.equal(all.audits.length, 3)
  assert.equal(all.truncated, undefined)

  const q = (await tool('list_audits').run({ query: 'ACME' }, ctx)).data as { audits: Array<{ name: string }> }
  assert.deepEqual(q.audits.map((a) => a.name), ['Acme', 'Beta'], 'matches domain and competitor domains, case-insensitive')

  const one = (await tool('list_audits').run({ limit: 1 }, ctx)).data as { audits: unknown[]; truncated?: boolean; hint?: string }
  assert.equal(one.audits.length, 1)
  assert.equal(one.truncated, true)
  assert.ok(one.hint)
})

test('list_clients trims rows, counts linked V4 audits and filters by query', async () => {
  sources.audits = async () => [auditItem({ clientId: CLIENT }), auditItem({ id: '33333333-3333-4333-8333-333333333333', clientId: CLIENT })]
  fakeRoute('clientsGet', (_b, req) => {
    assert.equal(new URL(req.url).searchParams.get('stage'), 'active')
    return json({
      clients: [
        { id: CLIENT, name: 'Acme Spa', domain: 'acme.it', industry: 'retail', status: 'active', lifecycle_stage: 'active', contact_email: 'secret@x.it', notes: 'private' },
        { id: 'c2', name: 'Other', domain: 'other.it', industry: null, status: 'active', lifecycle_stage: 'active' },
      ],
    })
  })
  const { data } = await tool('list_clients').run({ query: 'acme', stage: 'active' }, ctx)
  const out = data as { clients: Array<Record<string, unknown>> }
  assert.equal(out.clients.length, 1)
  assert.deepEqual(out.clients[0], {
    id: CLIENT,
    name: 'Acme Spa',
    domain: 'acme.it',
    industry: 'retail',
    status: 'active',
    lifecycleStage: 'active',
    v4AuditCount: 2,
  })
})

test('get_client reads the sync-params route and lists linked audits without PII', async () => {
  sources.audits = async () => [auditItem({ clientId: CLIENT }), auditItem({ id: '44444444-4444-4444-8444-444444444444', clientId: null })]
  fakeRoute('clientGet', (_b, _r, context) => {
    // /api/clients/[id] reads params.id synchronously.
    assert.equal((context.params as { id: string }).id, CLIENT)
    return json({ client: { id: CLIENT, name: 'Acme Spa', domain: 'acme.it', industry: 'retail', status: 'active', lifecycle_stage: 'prospect', contact_email: 'secret@x.it' } })
  })
  const { data } = await tool('get_client').run({ client_id: CLIENT }, ctx)
  const out = data as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- test-only digging
  assert.equal(out.lifecycleStage, 'prospect')
  assert.equal(out.v4AuditCount, 1)
  assert.equal(out.linkedAudits[0].id, AUDIT)
  assert.equal(JSON.stringify(out).includes('secret@x.it'), false)
})

// ---------------------------------------------------------------------------
// Write tools against fake routes
// ---------------------------------------------------------------------------

test('create_audit validates with SetupBody, posts the parsed body and never starts the run', async () => {
  fakeRoute('analysesPost', () =>
    json({ analysisId: AUDIT, refDate: '2026-10-31', mode: 'launch', sites: [{ site_ref: 'client', domain: 'acme.it' }], drivers: ['awareness'], templates: 2 }, 201),
  )
  const { data } = await tool('create_audit').run(
    {
      mode: 'launch',
      setup: {
        client: { domain: 'acme.it', brandName: 'Acme' },
        competitors: [{ domain: 'rival.it', brandName: 'Rival' }],
        siteType: 'ecommerce',
        drivers: ['speed'],
      },
    },
    ctx,
  )
  const post = callsTo('analysesPost')[0]
  assert.equal(post.method, 'POST')
  const sent = post.body as Record<string, unknown>
  assert.equal(sent.mode, 'launch')
  assert.equal(sent.country, 'IT', 'zod defaults are applied before posting')
  assert.equal(callsTo('start').length, 0)
  const out = data as { audit_id: string; started: boolean; next: string }
  assert.equal(out.audit_id, AUDIT)
  assert.equal(out.started, false)
  assert.match(out.next, /start_audit/)
})

test('create_audit relays the full list of setup problems', async () => {
  fakeRoute('analysesPost', () =>
    json({ error: 'setup invalid', details: ['il brand name del cliente è obbligatorio', 'il site type è obbligatorio'] }, 400),
  )
  await assert.rejects(
    tool('create_audit').run({ mode: 'launch', setup: { client: { domain: 'acme.it' } } }, ctx),
    (e: unknown) =>
      e instanceof McpToolError &&
      /il brand name del cliente è obbligatorio \| il site type è obbligatorio \(HTTP 400\)/.test(e.message),
  )
})

test('start_audit without drivers loads the saved setup and unions the Business four', async () => {
  fakeRoute('analysisGet', () => json(SAVED_SETUP))
  fakeRoute('start', () =>
    json({ status: 'accepted', analysisId: AUDIT, refDate: '2026-10-31', drivers: ['awareness'], dispatch: [{ driverKey: 'awareness', dispatched: true }, { driverKey: 'speed', dispatched: false, error: 'no secret' }] }, 202),
  )
  const { data } = await tool('start_audit').run({ audit_id: AUDIT }, ctx)
  assert.deepEqual(callsTo('start')[0].body, {
    drivers: ['awareness', 'ai_visibility', 'discoverability', 'traffic', 'speed', 'compliance'],
  })
  const out = data as { dispatched: number; dispatchFailures: string[]; hint: string }
  assert.equal(out.dispatched, 1)
  assert.deepEqual(out.dispatchFailures, ['speed: no secret'])
  assert.match(out.hint, /re-dispatched/)
})

test('start_audit with explicit drivers does not read the setup', async () => {
  fakeRoute('start', () => json({ status: 'accepted', drivers: ['speed'], dispatch: [{ driverKey: 'speed', dispatched: true }] }, 202))
  await tool('start_audit').run({ audit_id: AUDIT, drivers: ['speed'] }, ctx)
  assert.equal(callsTo('analysisGet').length, 0)
  assert.deepEqual(callsTo('start')[0].body, { drivers: ['speed'] })
})

test('start_audit relays the planner refusal', async () => {
  fakeRoute('start', () => json({ error: 'setup invalid', details: ['awareness richiede almeno un competitor'] }, 400))
  await assert.rejects(
    tool('start_audit').run({ audit_id: AUDIT, drivers: ['awareness'] }, ctx),
    (e: unknown) => e instanceof McpToolError && /awareness richiede almeno un competitor/.test(e.message),
  )
})

test('rerun_drivers relaunches one driver per call, reports partial refusals', async () => {
  fakeRoute('retry', (body) => {
    const b = body as { driver: string; force?: boolean }
    if (b.driver === 'traffic') {
      return json({ error: 'il driver traffic è completato: rimisurarlo azzera i dati misurati. Conferma con force:true', reason: 'done_needs_force' }, 409)
    }
    return json({ retried: [b.driver], skipped: [], remeasured: false, dispatchErrors: [] })
  })
  const { data } = await tool('rerun_drivers').run({ audit_id: AUDIT, drivers: ['speed', 'traffic'] }, ctx)
  const retries = callsTo('retry')
  assert.deepEqual(retries.map((c) => c.body), [{ driver: 'speed' }, { driver: 'traffic' }])
  const out = data as { partial: boolean; results: Array<Record<string, unknown>> }
  assert.equal(out.partial, true)
  assert.equal(out.results[0].relaunched, true)
  assert.equal(out.results[1].relaunched, false)
  assert.match(String(out.results[1].reason), /force:true/)
})

test('rerun_drivers passes force and jhorizon_answer; throws when nothing was relaunched', async () => {
  fakeRoute('retry', () => json({ retried: ['ai_visibility'], skipped: [], remeasured: true, dispatchErrors: [] }))
  await tool('rerun_drivers').run({ audit_id: AUDIT, drivers: ['ai_visibility'], force: true, jhorizon_answer: 'pasted' }, ctx)
  assert.deepEqual(callsTo('retry')[0].body, { driver: 'ai_visibility', force: true, jhorizon_answer: 'pasted' })

  fakeRoute('retry', () => json({ error: 'il driver speed è in esecuzione', reason: 'running' }, 409))
  await assert.rejects(
    tool('rerun_drivers').run({ audit_id: AUDIT, drivers: ['speed'] }, ctx),
    (e: unknown) => e instanceof McpToolError && /nothing was relaunched.*in esecuzione/.test(e.message),
  )
})

test('rerun_drivers without drivers sends the blanket retry (no body)', async () => {
  fakeRoute('retry', () => json({ retried: ['speed'], skipped: [{ driver_key: 'traffic', reason: 'done' }], dispatchErrors: [] }))
  const { data } = await tool('rerun_drivers').run({ audit_id: AUDIT }, ctx)
  assert.equal(callsTo('retry')[0].body, undefined)
  assert.deepEqual((data as { retried: string[] }).retried, ['speed'])
})

test('generate_insights sends {} for the full run and {drivers} for a targeted one', async () => {
  fakeRoute('insightsPost', (body) => json({ status: 'accepted', analysisId: AUDIT, drivers: (body as { drivers?: string[] }).drivers ?? ['traffic'], ...((body as { drivers?: string[] }).drivers ? { targeted: true } : {}) }, 202))
  await tool('generate_insights').run({ audit_id: AUDIT }, ctx)
  const targeted = (await tool('generate_insights').run({ audit_id: AUDIT, drivers: ['speed'] }, ctx)).data as { targeted: boolean; hint: string }
  assert.deepEqual(callsTo('insightsPost').map((c) => c.body), [{}, { drivers: ['speed'] }])
  assert.equal(targeted.targeted, true)
  assert.match(targeted.hint, /get_insights/)
})

test('generate_insights relays the precondition refusal (409)', async () => {
  fakeRoute('insightsPost', () => json({ error: 'decisione aperta su discoverability: risolvi il needs_decision prima di generare gli insight' }, 409))
  await assert.rejects(
    tool('generate_insights').run({ audit_id: AUDIT }, ctx),
    (e: unknown) => e instanceof McpToolError && /decisione aperta su discoverability/.test(e.message),
  )
})

test('resolve_decision refuses a driver that is not paused, without calling the decision route', async () => {
  fakeRoute('status', () => json(STATUS))
  fakeRoute('decision', () => json({ status: 'accepted' }, 202))
  await assert.rejects(
    tool('resolve_decision').run({ audit_id: AUDIT, driver: 'traffic', decision: { tier: 'relaxed_2' } }, ctx),
    (e: unknown) => e instanceof McpToolError && /"done", not needs_decision.*rerun_drivers/.test(e.message),
  )
  assert.equal(callsTo('decision').length, 0)
})

test('resolve_decision posts {decision} for a paused driver with the key as a route param', async () => {
  fakeRoute('status', () => json(STATUS))
  fakeRoute('decision', (_b, _r, context) => {
    const params = context.params as { id: string; key: string }
    assert.deepEqual({ id: params.id, key: params.key }, { id: AUDIT, key: 'discoverability' })
    return json({ status: 'accepted', driverKey: 'discoverability', dispatch: { driverKey: 'discoverability', dispatched: true } }, 202)
  })
  const { data } = await tool('resolve_decision').run({ audit_id: AUDIT, driver: 'discoverability', decision: { tier: 'relaxed_2' } }, ctx)
  const call = callsTo('decision')[0]
  assert.equal(call.url, `https://jboost.test/api/v4/analyses/${AUDIT}/drivers/discoverability/decision`)
  assert.deepEqual(call.body, { decision: { tier: 'relaxed_2' } })
  assert.equal((data as { result: string }).result, 'accepted')
})

test('resolve_decision reports a full re-run when a competitor is replaced', async () => {
  fakeRoute('status', () => json(STATUS))
  fakeRoute('decision', () => json({ status: 'replaced', from: 'rival.it', to: 'new.it', rerun: 'full', drivers: ['awareness', 'traffic'] }, 202))
  const { data } = await tool('resolve_decision').run(
    { audit_id: AUDIT, driver: 'discoverability', decision: { replace: { from: 'rival.it', to: 'new.it' } } },
    ctx,
  )
  const out = data as { rerun: string; replaced: { from: string; to: string }; drivers: string[] }
  assert.equal(out.rerun, 'full')
  assert.deepEqual(out.replaced, { from: 'rival.it', to: 'new.it' })
  assert.deepEqual(out.drivers, ['awareness', 'traffic'])
})

test('set_global_notes uses the notes-only PATCH shape (no read-modify-write)', async () => {
  fakeRoute('analysisPatch', (body) => json({ analysisId: AUDIT, globalNotes: (body as { global_notes: string }).global_notes.trim() }))
  const { data } = await tool('set_global_notes').run({ audit_id: AUDIT, notes: 'Tone: concise' }, ctx)
  const patch = callsTo('analysisPatch')[0]
  assert.equal(patch.method, 'PATCH')
  assert.deepEqual(patch.body, { global_notes: 'Tone: concise' })
  assert.equal(callsTo('analysisGet').length, 0)
  assert.deepEqual(data, { audit_id: AUDIT, globalNotes: 'Tone: concise', saved: true })
  // Empty string clears.
  await tool('set_global_notes').run({ audit_id: AUDIT, notes: '' }, ctx)
  assert.deepEqual(callsTo('analysisPatch')[1].body, { global_notes: '' })
})

test('publish_audit: default body, rerun:false, compact result and 409 relay', async () => {
  fakeRoute('publish', () =>
    json({ status: 'published', publishedAt: 't', editsPublished: 3, rerun: { drivers: ['speed'], ineligible: [], dispatchErrors: [] }, progress: { total: 4, done: 4, pending: 0 } }),
  )
  const { data } = await tool('publish_audit').run({ audit_id: AUDIT }, ctx)
  await tool('publish_audit').run({ audit_id: AUDIT, rerun: false }, ctx)
  assert.deepEqual(callsTo('publish').map((c) => c.body), [{}, { rerun: false }])
  const out = data as { editsPublished: number; rerun: { drivers: string[] } }
  assert.equal(out.editsPublished, 3)
  assert.deepEqual(out.rerun.drivers, ['speed'])

  fakeRoute('publish', () => json({ error: 'non pubblicabile: 2 driver ancora in coda o in esecuzione', progress: { pending: 2 } }, 409))
  await assert.rejects(
    tool('publish_audit').run({ audit_id: AUDIT }, ctx),
    (e: unknown) => e instanceof McpToolError && /non pubblicabile: 2 driver/.test(e.message),
  )
})

// ---------------------------------------------------------------------------
// trimJson
// ---------------------------------------------------------------------------

test('trimJson caps strings, arrays, keys and depth and reports truncation', () => {
  const small = trimJson({ a: 1, b: ['x'] }, TEXT_TRIM)
  assert.equal(small.truncated, false)
  assert.deepEqual(small.value, { a: 1, b: ['x'] })

  const opts = { maxString: 5, maxArray: 2, maxDepth: 2, maxKeys: 2 }
  const cut = trimJson({ s: 'abcdefghij', list: [1, 2, 3], deep: { x: { y: 1 } }, extra: 1 }, opts)
  assert.equal(cut.truncated, true)
  const v = cut.value as Record<string, unknown>
  assert.match(String(v.s), /^abcde… \[\+5 chars\]$/)
  assert.deepEqual(v._omittedKeys, 2)
})
