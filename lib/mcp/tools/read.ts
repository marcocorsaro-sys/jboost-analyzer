/**
 * MCP tools — READ side (readOnly: true). No API units are spent, nothing
 * changes. Every answer is deliberately compact: scores, statuses, per-site
 * values, failure reasons, trimmed evidence and insight text — never the raw
 * payload blobs.
 */

import { z } from 'zod'
import { McpToolError, type McpTool, type McpToolContext } from '@/lib/mcp/types'
import { V4_DRIVERS, getV4Driver } from '@/lib/scoring/registry'
import { computeOverallScore } from '@/lib/v4/audits'
import { routes, sources } from '@/lib/mcp/tools/routes'
import {
  auditIdOfArgs,
  auditIdSchema,
  auditPath,
  capList,
  clip,
  driverKeySchema,
  invokeObject,
  invokeRaw,
  isRecord,
  num,
  omitEmpty,
  parseArgs,
  str,
  arr,
  trimJson,
} from '@/lib/mcp/tools/shared'
import {
  compactDriverDetail,
  compactDriverSummary,
  compactInsight,
  sortDriverRows,
} from '@/lib/mcp/tools/compact'

const MAX_LIST = 50

// ---------------------------------------------------------------------------
// Audit listing
// ---------------------------------------------------------------------------

function matchesQuery(query: string | undefined, fields: Array<string | null | undefined>): boolean {
  if (!query) return true
  const haystack = fields.filter(Boolean).join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

const listAuditsArgs = z.object({
  limit: z.number().int().min(1).max(MAX_LIST).optional(),
  query: z.string().trim().min(1).max(200).optional(),
})

export const listAudits: McpTool = {
  name: 'list_audits',
  title: 'List audits',
  description:
    'List the V4 audits (Leader-Index website audits) the signed-in user can see, newest first. ' +
    'Each row has: code (the project code JBA-0001, the unambiguous way to name an audit: pass it as audit_id), id (UUID, also accepted), ' +
    'jhOrganizationId (the linked JHorizon organization, if set), name, domain, createdAt, ' +
    'state (draft | running | needs_decision | published), overallScore (0-100, mean of completed drivers; null until one completes), ' +
    'driversDone / driversTotal, driversNeedsDecision, driversError, competitors (domains), ' +
    'started (false = a draft setup that was never launched) and clientId (linked client, if any). ' +
    'Use this first to find an audit_id; narrow with `query` (matches code, name, domain, competitor domains or id). ' +
    `Read-only and free. At most ${MAX_LIST} rows; if truncated is true, refine the query.`,
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIST,
        description: `How many audits to return (default 20, max ${MAX_LIST}).`,
      },
      query: {
        type: 'string',
        description: 'Free text; every word must appear in the audit code (JBA-0020), name, domain, a competitor domain or its id.',
      },
    },
    additionalProperties: false,
  },
  readOnly: true,
  async run(args) {
    const { limit = 20, query } = parseArgs(listAuditsArgs, args, 'list_audits')
    // A text filter runs after the query, so fetch a wider window first.
    const audits = await sources.audits(query ? 200 : limit)
    const filtered = audits.filter((a) => matchesQuery(query, [a.code, a.name, a.domain, a.id, ...a.competitors]))
    const page = capList(filtered, limit)
    return {
      data: {
        returned: page.items.length,
        audits: page.items.map((a) => ({
          code: a.code,
          id: a.id,
          jhOrganizationId: a.jhOrganizationId,
          name: a.name,
          domain: a.domain,
          createdAt: a.createdAt,
          refDate: a.refDate,
          state: a.state,
          overallScore: a.overallScore,
          driversDone: a.driversDone,
          driversTotal: a.driversTotal,
          driversNeedsDecision: a.driversNeedsDecision,
          driversError: a.driversError,
          competitors: a.competitors,
          started: a.started,
          clientId: a.clientId,
        })),
        ...(page.truncated || audits.length >= (query ? 200 : limit)
          ? {
              truncated: true,
              hint: `Showing the newest ${page.items.length}; pass \`query\` (name or domain) or a larger limit (max ${MAX_LIST}) to find older audits.`,
            }
          : {}),
      },
    }
  },
}

// ---------------------------------------------------------------------------
// get_audit
// ---------------------------------------------------------------------------

const auditArgs = z.object({ audit_id: auditIdSchema })

const SETUP_TRIM = { maxString: 400, maxArray: 50, maxDepth: 4, maxKeys: 30 }

export const getAudit: McpTool = {
  name: 'get_audit',
  title: 'Get audit overview',
  description:
    'Overview of one audit: its saved setup (client + competitor sites, page templates, enabled drivers, industry, country, REF_DATE, ' +
    'thematic clusters, blocklist, global notes), overall progress and ONE ROW PER DRIVER with status (queued | running | done | error | needs_decision), ' +
    'absolute / relative scores (0-100 Leader Index), failure reason when it failed, partial-coverage notes and, for a paused driver, ' +
    'the question it is waiting on (decisionRequest, see resolve_decision). ' +
    'Use it to answer "how is audit X doing / what failed / what is waiting for me". For per-site values and evidence call get_driver. ' +
    'Read-only and free. Driver keys are listed by get_driver_catalog.',
  inputSchema: {
    type: 'object',
    properties: {
      audit_id: { type: 'string', format: 'uuid', description: 'Audit id, from list_audits.' },
    },
    required: ['audit_id'],
    additionalProperties: false,
  },
  readOnly: true,
  analysisIdOf: auditIdOfArgs,
  async run(args, ctx: McpToolContext) {
    const { audit_id } = parseArgs(auditArgs, args, 'get_audit')
    const params = { id: audit_id }
    const [status, saved] = await Promise.all([
      invokeObject(ctx, routes.status, { method: 'GET', path: auditPath(audit_id, '/status'), params }, 'get_audit (status)'),
      invokeObject(ctx, routes.analysisGet, { method: 'GET', path: auditPath(audit_id), params }, 'get_audit (setup)'),
    ])

    const rows = sortDriverRows(arr(status.drivers).filter(isRecord))
    const setup = trimJson(saved.setup ?? null, SETUP_TRIM)
    const notes = str(status.globalNotes)
    const overallScore = computeOverallScore(
      rows.map((r) => ({
        enabled: r.enabled !== false,
        status: str(r.status) ?? '',
        score_absolute: num(r.score_absolute),
        score_relative: num(r.score_relative),
      })),
    )

    return {
      data: {
        audit_id,
        projectCode: str(status.projectCode),
        jhOrganizationId: str(status.jhOrganizationId),
        name: str(status.brandName) ?? str(status.domain),
        domain: str(status.domain),
        refDate: str(status.refDate),
        industryPreset: str(status.industryPreset),
        country: str(status.country),
        clientId: str(status.clientId),
        started: rows.length > 0,
        overallScore,
        progress: status.progress ?? null,
        sites: arr(status.sites).filter(isRecord).map((s) => ({
          site_ref: str(s.site_ref),
          domain: str(s.domain),
          is_client: s.is_client === true,
        })),
        globalNotes: notes ? clip(notes, 3000) : null,
        setup: setup.value,
        drivers: rows.map(compactDriverSummary),
        ...(setup.truncated || (notes && notes.length > 3000)
          ? { truncated: true, hint: 'Setup or notes were shortened; the saved values are complete in the web app.' }
          : {}),
      },
    }
  },
}

// ---------------------------------------------------------------------------
// get_driver
// ---------------------------------------------------------------------------

const driverArgs = z.object({ audit_id: auditIdSchema, driver: driverKeySchema })

export const getDriver: McpTool = {
  name: 'get_driver',
  title: 'Get driver detail',
  description:
    'One driver of one audit in detail: status, client raw value, absolute / relative scores, per-site values ' +
    '(raw, score, rank, trimmed evidence), tier used, unmeasured sites and the recorded reason for each, partial-coverage note, ' +
    'failure reason, the full decisionRequest if the driver is paused (needs_decision), and its generated LLM insight when one exists. ' +
    'Use it to explain WHY a score is what it is, or what blocks a driver. Evidence and long tables are trimmed (truncated: true tells you). ' +
    'Read-only and free.',
  inputSchema: {
    type: 'object',
    properties: {
      audit_id: { type: 'string', format: 'uuid', description: 'Audit id, from list_audits.' },
      driver: {
        type: 'string',
        enum: V4_DRIVERS.map((d) => d.key),
        description: 'Driver key (see get_driver_catalog).',
      },
    },
    required: ['audit_id', 'driver'],
    additionalProperties: false,
  },
  readOnly: true,
  analysisIdOf: auditIdOfArgs,
  async run(args, ctx: McpToolContext) {
    const { audit_id, driver } = parseArgs(driverArgs, args, 'get_driver')
    const params = { id: audit_id }
    const [status, insights] = await Promise.all([
      invokeObject(ctx, routes.status, { method: 'GET', path: auditPath(audit_id, '/status'), params }, 'get_driver (status)'),
      // The insight is a bonus: a failure here must not hide the measurement.
      invokeRaw(ctx, routes.insightsGet, { method: 'GET', path: auditPath(audit_id, '/insights'), params }),
    ])

    const rows = arr(status.drivers).filter(isRecord)
    const row = rows.find((r) => r.driver_key === driver)
    if (!row) {
      const available = rows.map((r) => str(r.driver_key)).filter(Boolean).join(', ')
      throw new McpToolError(
        `Driver "${driver}" has no run in this audit (the audit may not be started yet). Drivers with a run: ${available || 'none'}.`,
      )
    }

    const detail = compactDriverDetail(row)
    let insight: Record<string, unknown> | null = null
    let truncated = detail.truncated
    let insightsStatus: string | null = null
    if (insights.ok && isRecord(insights.json)) {
      insightsStatus = str(insights.json.insightsStatus)
      const entry = arr(insights.json.drivers)
        .filter(isRecord)
        .find((d) => d.driver_key === driver)
      const compact = compactInsight(entry?.insight)
      insight = compact.insight
      if (compact.truncated) truncated = true
    }

    const def = getV4Driver(driver)
    return {
      data: {
        audit_id,
        ...detail.driver,
        definition: def
          ? {
              source: def.source,
              hasAbsoluteView: def.hasAbsoluteView,
              competitorMandatory: def.competitorMandatory,
              normalization: def.normalization,
            }
          : null,
        insight,
        ...omitEmpty({ insightsStatus: insight ? null : insightsStatus }),
        ...(truncated
          ? { truncated: true, hint: 'Evidence / text was shortened to fit; scores and per-site values are complete.' }
          : {}),
      },
    }
  },
}

// ---------------------------------------------------------------------------
// get_insights
// ---------------------------------------------------------------------------

export const getInsights: McpTool = {
  name: 'get_insights',
  title: 'Get audit insights',
  description:
    'The generated narrative of an audit: per-driver LLM insights (comments plus ranked findings / recommendations) and the Executive Summary ' +
    '(key correlations, strategic priorities), with the generation status (insightsStatus: running | done | error, and insightsError). ' +
    'Use it to read or summarise what the audit concludes. If insights are missing or stale, generate_insights creates them. ' +
    'While insightsStatus is "running", wait a bit and call again. Read-only and free.',
  inputSchema: {
    type: 'object',
    properties: {
      audit_id: { type: 'string', format: 'uuid', description: 'Audit id, from list_audits.' },
    },
    required: ['audit_id'],
    additionalProperties: false,
  },
  readOnly: true,
  analysisIdOf: auditIdOfArgs,
  async run(args, ctx: McpToolContext) {
    const { audit_id } = parseArgs(auditArgs, args, 'get_insights')
    const json = await invokeObject(
      ctx,
      routes.insightsGet,
      { method: 'GET', path: auditPath(audit_id, '/insights'), params: { id: audit_id } },
      'get_insights',
    )

    let truncated = false
    const summary = compactInsight(json.executiveSummary)
    if (summary.truncated) truncated = true

    const drivers = arr(json.drivers)
      .filter(isRecord)
      .sort((a, b) => (num(a.llm_sequence) ?? 99) - (num(b.llm_sequence) ?? 99))
      .map((d) => {
        const compact = compactInsight(d.insight)
        if (compact.truncated) truncated = true
        return {
          driver: str(d.driver_key),
          status: str(d.status),
          llmSequence: num(d.llm_sequence),
          insight: compact.insight,
        }
      })

    const insightsStatus = str(json.insightsStatus)
    return {
      data: {
        audit_id,
        insightsStatus,
        ...omitEmpty({ insightsError: str(json.insightsError) }),
        executiveSummary: summary.insight,
        drivers,
        ...(insightsStatus === 'running'
          ? { hint: 'Generation is still running; call get_insights again in about a minute.' }
          : {}),
        ...(truncated ? { truncated: true, hint: 'Some long text was shortened to fit.' } : {}),
      },
    }
  },
}

// ---------------------------------------------------------------------------
// get_controller
// ---------------------------------------------------------------------------

const MAX_FINDINGS = 50

export const getController: McpTool = {
  name: 'get_controller',
  title: 'Run audit controller checks',
  description:
    'The Controller pass for one audit: a deterministic reviewer that flags what no single driver can see ' +
    '(domains outside the current set, broken leader invariant, stuck jobs, exhausted retries, low measurement coverage, stale unpublished edits, insight problems). ' +
    'Returns findings (severity error | warning | info, check slug, driver, message, suggestion) sorted worst first, plus counts per severity. ' +
    'Messages are written in Italian. It is recomputed on every call and nothing is stored. ' +
    `Use it to answer "is this audit sound / what should I fix?". Read-only and free. At most ${MAX_FINDINGS} findings.`,
  inputSchema: {
    type: 'object',
    properties: {
      audit_id: { type: 'string', format: 'uuid', description: 'Audit id, from list_audits.' },
    },
    required: ['audit_id'],
    additionalProperties: false,
  },
  readOnly: true,
  analysisIdOf: auditIdOfArgs,
  async run(args, ctx: McpToolContext) {
    const { audit_id } = parseArgs(auditArgs, args, 'get_controller')
    const json = await invokeObject(
      ctx,
      routes.controllerGet,
      { method: 'GET', path: auditPath(audit_id, '/controller'), params: { id: audit_id } },
      'get_controller',
    )
    const findings = capList(arr(json.findings).filter(isRecord), MAX_FINDINGS)
    return {
      data: {
        audit_id,
        counts: json.counts ?? null,
        checkedAt: str(json.checked_at),
        findings: findings.items.map((f) =>
          omitEmpty({
            severity: str(f.severity),
            check: str(f.check),
            driver: str(f.driver_key),
            message: clip(str(f.message) ?? '', 500),
            suggestion: str(f.suggestion) ? clip(str(f.suggestion) as string, 300) : null,
          }),
        ),
        ...(findings.truncated
          ? { truncated: true, hint: `Showing the ${MAX_FINDINGS} most severe of ${findings.total} findings.` }
          : {}),
      },
    }
  },
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const STAGES = ['prospect', 'active', 'churned', 'archived'] as const

const listClientsArgs = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  stage: z.enum(STAGES, { errorMap: () => ({ message: `stage must be one of: ${STAGES.join(', ')}` }) }).optional(),
  limit: z.number().int().min(1).max(MAX_LIST).optional(),
})

function compactClient(client: Record<string, unknown>): Record<string, unknown> {
  return {
    id: str(client.id),
    name: str(client.name),
    domain: str(client.domain),
    industry: str(client.industry),
    status: str(client.status),
    lifecycleStage: str(client.lifecycle_stage),
  }
}

export const listClients: McpTool = {
  name: 'list_clients',
  title: 'List clients',
  description:
    'List the clients the signed-in user can access (own and shared). Each row: id, name, domain, industry, status (active | archived), ' +
    'lifecycleStage (prospect | active | churned | archived) and v4AuditCount (audits linked to the client). ' +
    'Use it to resolve a client name to a client_id (get_client) or to find the audits of a client. ' +
    `Read-only and free. At most ${MAX_LIST} rows.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free text matched against client name, domain and industry.' },
      stage: { type: 'string', enum: [...STAGES], description: 'Only clients in this lifecycle stage.' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIST, description: `Max rows (default 25, max ${MAX_LIST}).` },
    },
    additionalProperties: false,
  },
  readOnly: true,
  async run(args, ctx: McpToolContext) {
    const { query, stage, limit = 25 } = parseArgs(listClientsArgs, args, 'list_clients')
    const [json, audits] = await Promise.all([
      invokeObject(ctx, routes.clientsGet, { method: 'GET', path: '/api/clients', query: { stage } }, 'list_clients'),
      sources.audits(200),
    ])

    const auditCount = new Map<string, number>()
    for (const a of audits) {
      if (a.clientId) auditCount.set(a.clientId, (auditCount.get(a.clientId) ?? 0) + 1)
    }

    const clients = arr(json.clients)
      .filter(isRecord)
      .filter((c) => matchesQuery(query, [str(c.name), str(c.domain), str(c.industry)]))
    const page = capList(clients, limit)
    return {
      data: {
        returned: page.items.length,
        clients: page.items.map((c) => ({
          ...compactClient(c),
          v4AuditCount: auditCount.get(str(c.id) ?? '') ?? 0,
        })),
        ...(page.truncated
          ? { truncated: true, hint: `Showing ${page.items.length} of ${page.total}; pass \`query\` or \`stage\` to narrow.` }
          : {}),
      },
    }
  },
}

const clientArgs = z.object({
  client_id: z
    .string({ required_error: 'client_id is required (use list_clients to find it)' })
    .uuid('client_id must be a UUID (use list_clients to find it)'),
})

const MAX_LINKED = 20

export const getClient: McpTool = {
  name: 'get_client',
  title: 'Get client',
  description:
    'One client in brief: name, domain, industry, status, lifecycleStage and the V4 audits linked to it ' +
    '(count plus the newest ones with id, name, state, overallScore, createdAt). Contact details and notes are intentionally not returned. ' +
    'Use the linked audit ids with get_audit. Read-only and free.',
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid', description: 'Client id, from list_clients.' },
    },
    required: ['client_id'],
    additionalProperties: false,
  },
  readOnly: true,
  async run(args, ctx: McpToolContext) {
    const { client_id } = parseArgs(clientArgs, args, 'get_client')
    // /api/clients/[id] reads params synchronously; callRoute supports both styles.
    const [json, audits] = await Promise.all([
      invokeObject(
        ctx,
        routes.clientGet,
        { method: 'GET', path: `/api/clients/${client_id}`, params: { id: client_id } },
        'get_client',
      ),
      sources.audits(200),
    ])
    if (!isRecord(json.client)) throw new McpToolError('get_client: the route returned no client.')

    const linked = audits.filter((a) => a.clientId === client_id)
    const page = capList(linked, MAX_LINKED)
    return {
      data: {
        ...compactClient(json.client),
        v4AuditCount: linked.length,
        linkedAudits: page.items.map((a) => ({
          id: a.id,
          name: a.name,
          state: a.state,
          overallScore: a.overallScore,
          createdAt: a.createdAt,
        })),
        ...(page.truncated
          ? { truncated: true, hint: `Showing the newest ${MAX_LINKED} of ${page.total} linked audits.` }
          : {}),
      },
    }
  },
}

// ---------------------------------------------------------------------------
// get_driver_catalog (pure)
// ---------------------------------------------------------------------------

export const getDriverCatalog: McpTool = {
  name: 'get_driver_catalog',
  title: 'Driver catalog',
  description:
    'The 10 drivers a V4 audit can measure, in display order (Business first): key, label, family (business | development), ' +
    'competitorMandatory, hasAbsoluteView and the data source each one spends API units on, plus a short note on how scores are computed. ' +
    'Call it to learn the valid driver keys for get_driver, start_audit, rerun_drivers, generate_insights and resolve_decision, ' +
    'and to know which drivers cost which provider. Static data: no network, free.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  readOnly: true,
  async run() {
    const drivers = [...V4_DRIVERS]
      .sort((a, b) => a.uiOrder - b.uiOrder)
      .map((d) => ({
        key: d.key,
        label: d.label,
        family: d.family,
        competitorMandatory: d.competitorMandatory,
        hasAbsoluteView: d.hasAbsoluteView,
        normalization: d.normalization,
        hasInsight: d.llmSequence !== null,
        source: d.source,
      }))
    return {
      data: {
        drivers,
        scoring:
          'Leader Index: every raw value is expressed as a percentage of the best site in the audited set (leader = 100). ' +
          'Linear by default, log10 for Traffic. A site that could not be measured has a null score and is excluded, never counted as 0. ' +
          'Relative score = vs the set; absolute score (only where hasAbsoluteView) = intrinsic 0-100. ' +
          'overallScore = mean of the completed drivers. The four Business drivers (awareness, ai_visibility, discoverability, traffic) ' +
          'are mandatory in every audit and need at least one competitor.',
      },
    }
  },
}

export const READ_TOOLS: McpTool[] = [
  listAudits,
  getAudit,
  getDriver,
  getInsights,
  getController,
  listClients,
  getClient,
  getDriverCatalog,
]
