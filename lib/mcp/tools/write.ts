/**
 * MCP tools — WRITE side (readOnly: false). Every one goes through the
 * existing /api/v4 route, so the web app's guards (RLS, setup validation,
 * planner gating, status preconditions) apply unchanged. Several of them
 * spend paid API units (Ahrefs, Semrush, Similarweb, PageSpeed, Firecrawl,
 * Anthropic); the descriptions say which, because the protocol layer asks the
 * human to approve each write before it runs.
 */

import { z } from 'zod'
import { McpToolError, type McpTool, type McpToolContext } from '@/lib/mcp/types'
import { V4_DRIVERS } from '@/lib/scoring/registry'
import {
  ANALYSIS_COUNTRIES,
  INDUSTRY_PRESETS,
  SITE_TYPES,
  TARGET_AUDIENCE_MODES,
  TEMPLATE_KEYS,
  withMandatoryDrivers,
} from '@/lib/v4/setup'
import { SetupBody } from '@/lib/v4/setup-request'
import { routes } from '@/lib/mcp/tools/routes'
import {
  arr,
  auditIdOfArgs,
  auditIdSchema,
  auditPath,
  clip,
  driverKeySchema,
  invokeObject,
  invokeRaw,
  isRecord,
  num,
  omitEmpty,
  parseArgs,
  str,
} from '@/lib/mcp/tools/shared'
import { routeErrorMessage } from '@/lib/mcp/call-route'

const AUDIT_ID_PROP = { type: 'string', format: 'uuid', description: 'Audit id, from list_audits or create_audit.' }
const DRIVER_ENUM = V4_DRIVERS.map((d) => d.key)

const APPROVAL = 'The user is asked to approve this call before it runs.'

/** Driver list a tool may receive: known keys, no duplicates. */
const driverListSchema = z
  .array(driverKeySchema)
  .min(1, 'drivers must list at least one driver key')
  .refine((list) => new Set(list).size === list.length, 'drivers must not repeat a key')

// ---------------------------------------------------------------------------
// create_audit
// ---------------------------------------------------------------------------

const siteSchema = z
  .object({
    domain: z.string().min(1, 'domain is required'),
    brandName: z.string().nullable().optional(),
    brandVariants: z.array(z.string()).optional(),
  })
  .strict()

/**
 * The route's own SetupBody, reused so the wire format cannot drift, made
 * strict at the tool boundary: a misspelled field (brand_name for brandName)
 * must fail loudly instead of being silently dropped by zod's default strip.
 * `mode` moves to the tool's own argument.
 */
const toolSetupSchema = SetupBody.omit({ mode: true })
  .strict()
  .extend({
    client: siteSchema,
    competitors: z.array(siteSchema).default([]),
    siteType: z
      .enum(SITE_TYPES, { errorMap: () => ({ message: `siteType must be one of: ${SITE_TYPES.join(', ')}` }) })
      .nullable()
      .optional(),
  })

const createAuditArgs = z.object({
  mode: z.enum(['draft', 'launch'], { errorMap: () => ({ message: "mode must be 'draft' or 'launch'" }) }),
  setup: toolSetupSchema,
})

const SITE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string', description: 'Bare domain or URL of the site, e.g. "example.com".' },
    brandName: {
      type: ['string', 'null'],
      description: 'Brand name. Mandatory at launch for the client and for every competitor.',
    },
    brandVariants: {
      type: 'array',
      items: { type: 'string' },
      description: 'Alternative spellings of the brand (used by the Awareness driver).',
    },
  },
  required: ['domain'],
  additionalProperties: false,
}

const SETUP_JSON_SCHEMA = {
  type: 'object',
  description:
    'The audit setup, same fields as the web wizard. Launch mode needs: client.brandName, siteType, at least one country, ' +
    'at least one competitor with a brandName, and 3-10 thematicClusters if any are given.',
  properties: {
    clientId: {
      type: ['string', 'null'],
      format: 'uuid',
      description: 'Link the audit to an existing client (from list_clients). The caller must have access to it.',
    },
    jhOrganizationId: {
      type: ['string', 'null'],
      description: "JHorizon organization id of the client (optional); stored on the audit so AI Visibility data can be pulled with the right id.",
    },
    client: { ...SITE_JSON_SCHEMA, description: 'The audited site (the client).' },
    competitors: {
      type: 'array',
      maxItems: 4,
      items: SITE_JSON_SCHEMA,
      description: 'Up to 4 competitors. Business drivers need at least 1 to launch.',
    },
    country: { type: 'string', description: 'Primary ISO country code, default "IT".' },
    countries: {
      type: 'array',
      items: { type: 'string' },
      description: `Analysis countries (ISO codes; first = primary). Known: ${ANALYSIS_COUNTRIES.map((c) => c.code).join(', ')}. Defaults to [country].`,
    },
    outputLanguage: { type: 'string', enum: ['it', 'en'], description: 'Language of generated insights (default "it").' },
    industryPreset: {
      type: ['string', 'null'],
      enum: [...INDUSTRY_PRESETS, null],
      description: 'Industry preset that tunes insight generation.',
    },
    sector: { type: ['string', 'null'], description: 'Free-text sector beyond the preset list.' },
    siteType: {
      type: ['string', 'null'],
      enum: [...SITE_TYPES, null],
      description: 'Type of site. Required at launch.',
    },
    targetAudienceMode: {
      type: ['string', 'null'],
      enum: [...TARGET_AUDIENCE_MODES, null],
      description: 'B2B, B2C or both.',
    },
    targetAudience: { type: ['string', 'null'], description: 'Free-text description of the target audience.' },
    seoMaturity: {
      type: ['string', 'null'],
      enum: ['low', 'medium', 'high', null],
      description: 'Analyst estimate of the client SEO maturity.',
    },
    drivers: {
      type: 'array',
      items: { type: 'string', enum: DRIVER_ENUM },
      description:
        'Drivers to enable. The four Business drivers (awareness, ai_visibility, discoverability, traffic) are ALWAYS added by the server; ' +
        'list the Development drivers you want (compliance, schema, speed, accessibility, content, authority).',
    },
    templates: {
      type: 'object',
      description:
        `Page URLs to measure: { <site_ref>: { <template_key>: "<full URL>" } }. site_ref is "client", "competitor_1".."competitor_4"; ` +
        `template_key is one of ${TEMPLATE_KEYS.join(', ')}. Homepage defaults to https://<domain>; other templates are only measured when a URL is given.`,
      additionalProperties: { type: 'object', additionalProperties: { type: 'string' } },
    },
    driverTemplates: {
      type: 'object',
      description: 'Which template keys each page driver measures: { speed|accessibility|schema|content: [template_key, ...] }.',
      additionalProperties: { type: 'array', items: { type: 'string', enum: [...TEMPLATE_KEYS] } },
    },
    jhorizonAnswer: {
      type: ['string', 'null'],
      description: 'J-Horizon AI-visibility recap already pasted at setup time (feeds the ai_visibility driver).',
    },
    thematicClusters: {
      type: 'array',
      items: { type: 'string' },
      description: '3-10 macro-themes for Discoverability.',
    },
    blocklist: { type: 'array', items: { type: 'string' }, description: 'Words the generated insights must not use.' },
    maxInsights: { type: ['integer', 'null'], minimum: 1, description: 'Cap on insights / actions per driver.' },
    additionalNotes: { type: ['string', 'null'], description: 'Free notes for the insight model.' },
  },
  required: ['client'],
  additionalProperties: false,
}

export const createAudit: McpTool = {
  name: 'create_audit',
  title: 'Create audit',
  description:
    'Create a V4 audit from a setup (client site, up to 4 competitors, countries, drivers, page templates...). ' +
    "mode 'draft' saves whatever is given (only structural errors block); mode 'launch' validates every required field and the driver plan. " +
    'It does NOT start the measurement: the audit stays unstarted until start_audit is called. ' +
    'Returns audit_id, projectCode (JBA-NNNN, assigned automatically), the resolved sites, the effective drivers (Business four are always added) and the number of templates, or the full list of setup problems. ' +
    'Cost: no paid API units; it writes the audit and its page-template rows. A saved draft can only be completed in the web app wizard. ' +
    APPROVAL,
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['draft', 'launch'],
        description: "'draft' = save as incomplete; 'launch' = fully validated setup, ready for start_audit.",
      },
      setup: SETUP_JSON_SCHEMA,
    },
    required: ['mode', 'setup'],
    additionalProperties: false,
  },
  readOnly: false,
  async run(args, ctx: McpToolContext) {
    const { mode, setup } = parseArgs(createAuditArgs, args, 'create_audit')
    // Same parser the route runs: what we send is exactly what it will accept.
    const body = SetupBody.parse({ ...setup, mode })
    const json = await invokeObject(ctx, routes.analysesPost, { method: 'POST', path: '/api/v4/analyses', body }, 'create_audit')
    const auditId = str(json.analysisId)
    return {
      data: {
        audit_id: auditId,
        projectCode: str(json.projectCode),
        mode: str(json.mode) ?? mode,
        refDate: str(json.refDate),
        started: false,
        sites: json.sites ?? [],
        drivers: json.drivers ?? [],
        templates: num(json.templates),
        next:
          mode === 'launch'
            ? 'Setup saved and validated. Nothing has run yet: call start_audit with this audit_id to launch the measurement (spends paid API units).'
            : 'Draft saved. It cannot be started until the setup is complete: finish it in the web app wizard (resume), or create a new audit with mode "launch".',
      },
    }
  },
}

// ---------------------------------------------------------------------------
// start_audit
// ---------------------------------------------------------------------------

const startAuditArgs = z.object({
  audit_id: auditIdSchema,
  drivers: driverListSchema.optional(),
})

export const startAudit: McpTool = {
  name: 'start_audit',
  title: 'Start audit',
  description:
    'Launch the measurement of a saved audit: plans the runs, queues one job per driver and fans them out in the background. ' +
    'Returns immediately (HTTP 202 semantics); the drivers then run for minutes, so poll get_audit until progress.complete. ' +
    'Without `drivers` it uses the drivers enabled in the saved setup (the Business four are always included). ' +
    'It is idempotent: calling it again on a started audit only seeds drivers that have no run yet and never resets finished ones. ' +
    'Planner gating happens before anything is spent (e.g. Business drivers need a competitor). ' +
    'Cost: SPENDS PAID API UNITS, scaling with sites x drivers: Ahrefs (awareness, discoverability, authority), Similarweb (traffic), ' +
    'Semrush (compliance), Google PageSpeed (speed, accessibility; one call per page x device), Firecrawl + LLM (schema). ' +
    APPROVAL,
  inputSchema: {
    type: 'object',
    properties: {
      audit_id: AUDIT_ID_PROP,
      drivers: {
        type: 'array',
        items: { type: 'string', enum: DRIVER_ENUM },
        minItems: 1,
        uniqueItems: true,
        description: 'Drivers to run. Omit to run every driver enabled in the saved setup.',
      },
    },
    required: ['audit_id'],
    additionalProperties: false,
  },
  readOnly: false,
  analysisIdOf: auditIdOfArgs,
  async run(args, ctx: McpToolContext) {
    const { audit_id, drivers: requested } = parseArgs(startAuditArgs, args, 'start_audit')
    const params = { id: audit_id }

    let drivers = requested
    if (!drivers) {
      // Same source the wizard uses: the setup saved on the audit. The server
      // unions the Business four at create time for validation only, so do it
      // here too, otherwise a launch setup that listed none would plan nothing.
      const saved = await invokeObject(ctx, routes.analysisGet, { method: 'GET', path: auditPath(audit_id), params }, 'start_audit (load setup)')
      const setup = isRecord(saved.setup) ? saved.setup : {}
      const enabled = arr(setup.enabledDrivers).filter((d): d is string => typeof d === 'string')
      drivers = withMandatoryDrivers(enabled)
    }

    const json = await invokeObject(
      ctx,
      routes.start,
      { method: 'POST', path: auditPath(audit_id, '/start'), params, body: { drivers } },
      'start_audit',
    )

    const dispatch = arr(json.dispatch).filter(isRecord)
    const failures = dispatch
      .filter((d) => d.dispatched === false)
      .map((d) => `${str(d.driverKey)}: ${str(d.error) ?? 'dispatch failed'}`)
    return {
      data: {
        audit_id,
        status: str(json.status),
        refDate: str(json.refDate),
        drivers: json.drivers ?? drivers,
        dispatched: dispatch.length - failures.length,
        ...omitEmpty({ dispatchFailures: failures }),
        hint:
          failures.length > 0
            ? 'Some jobs were queued but not dispatched; they stay queued and are re-dispatched on the next status poll. Poll get_audit.'
            : 'Running in the background. Poll get_audit until progress.complete is true.',
      },
    }
  },
}

// ---------------------------------------------------------------------------
// rerun_drivers
// ---------------------------------------------------------------------------

const rerunArgs = z
  .object({
    audit_id: auditIdSchema,
    drivers: driverListSchema.optional(),
    force: z.boolean().optional(),
    jhorizon_answer: z.string().trim().min(1).max(60_000).optional(),
  })
  .superRefine((value, issue) => {
    if (value.jhorizon_answer && !(value.drivers?.length === 1 && value.drivers[0] === 'ai_visibility')) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['jhorizon_answer'],
        message: "jhorizon_answer is only accepted together with drivers: ['ai_visibility']",
      })
    }
  })

export const rerunDrivers: McpTool = {
  name: 'rerun_drivers',
  title: 'Re-run drivers',
  description:
    'Re-run drivers of an audit that already exists, without recreating it. ' +
    'With `drivers`, each listed driver is relaunched one by one: a failed (error) or stuck (queued) driver just retries with a fresh attempt budget; ' +
    'a COMPLETED driver is re-measured as of today only with force: true, which clears its measured values and insight (analyst edits and decisions are kept). ' +
    'A driver that is running or waiting for a decision (needs_decision) is refused: use resolve_decision for the latter. ' +
    'Without `drivers` it retries every failed or stuck driver of the audit (never touches completed ones). ' +
    "For ai_visibility with force you may pass `jhorizon_answer` (a fresh J-Horizon paste) as the new input. " +
    'Returns, per driver, whether it was relaunched or why not. Runs in the background: poll get_audit. ' +
    'Cost: SPENDS PAID API UNITS again for each relaunched driver (same providers as start_audit; see get_driver_catalog). ' +
    APPROVAL,
  inputSchema: {
    type: 'object',
    properties: {
      audit_id: AUDIT_ID_PROP,
      drivers: {
        type: 'array',
        items: { type: 'string', enum: DRIVER_ENUM },
        minItems: 1,
        uniqueItems: true,
        description: 'Drivers to relaunch. Omit to retry only the failed or stuck ones.',
      },
      force: {
        type: 'boolean',
        description: 'Required to re-measure a driver that is already done (discards its measured values). Default false.',
      },
      jhorizon_answer: {
        type: 'string',
        description: "New J-Horizon answer text; only valid with drivers: ['ai_visibility'].",
      },
    },
    required: ['audit_id'],
    additionalProperties: false,
  },
  readOnly: false,
  analysisIdOf: auditIdOfArgs,
  async run(args, ctx: McpToolContext) {
    const { audit_id, drivers, force, jhorizon_answer } = parseArgs(rerunArgs, args, 'rerun_drivers')
    const base = { method: 'POST' as const, path: auditPath(audit_id, '/retry'), params: { id: audit_id } }

    // Blanket retry: error + queued rows only.
    if (!drivers) {
      const json = await invokeObject(ctx, routes.retry, base, 'rerun_drivers')
      return {
        data: {
          audit_id,
          retried: json.retried ?? [],
          skipped: json.skipped ?? [],
          ...omitEmpty({ message: str(json.message), dispatchErrors: arr(json.dispatchErrors) }),
        },
      }
    }

    // The route relaunches one driver per call: run them in order so two
    // writes never race on the same audit.
    const results: Array<Record<string, unknown>> = []
    for (const driver of drivers) {
      const body = {
        driver,
        ...(force ? { force: true } : {}),
        ...(jhorizon_answer ? { jhorizon_answer } : {}),
      }
      const res = await invokeRaw(ctx, routes.retry, { ...base, body })
      if (res.ok && isRecord(res.json)) {
        results.push(
          omitEmpty({
            driver,
            relaunched: true,
            remeasured: res.json.remeasured === true ? true : null,
            dispatchErrors: arr(res.json.dispatchErrors),
          }),
        )
      } else {
        results.push({ driver, relaunched: false, reason: clip(routeErrorMessage(res), 500) })
      }
    }

    const relaunched = results.filter((r) => r.relaunched === true)
    if (relaunched.length === 0) {
      throw new McpToolError(
        `rerun_drivers: nothing was relaunched. ${results.map((r) => `${String(r.driver)}: ${String(r.reason)}`).join(' | ')}`,
        { results },
      )
    }
    return {
      data: {
        audit_id,
        results,
        ...(relaunched.length < results.length
          ? { partial: true, hint: 'Some drivers were refused (see reason); the others are running. Poll get_audit.' }
          : { hint: 'Running in the background. Poll get_audit.' }),
      },
    }
  },
}

// ---------------------------------------------------------------------------
// generate_insights
// ---------------------------------------------------------------------------

const insightsArgs = z.object({ audit_id: auditIdSchema, drivers: driverListSchema.optional() })

export const generateInsights: McpTool = {
  name: 'generate_insights',
  title: 'Generate insights',
  description:
    'Generate (or regenerate) the narrative LLM insights of an audit. ' +
    'Without `drivers`: the full orchestration, one insight per completed driver in sequence plus the Executive Summary; stored insights are kept, errored ones are regenerated. ' +
    'It requires every enabled driver to be finished (done or error) with no pending needs_decision, otherwise it is refused with the reason. ' +
    'With `drivers`: only those drivers are regenerated (they must be done and have an insight); their stored insight is cleared first, and the Executive Summary is not touched. ' +
    'Runs in the background: poll get_insights until insightsStatus is "done" or "error". ' +
    'Cost: LLM tokens only (Anthropic): about one call per driver plus one for the summary. No data-provider units. ' +
    APPROVAL,
  inputSchema: {
    type: 'object',
    properties: {
      audit_id: AUDIT_ID_PROP,
      drivers: {
        type: 'array',
        items: { type: 'string', enum: DRIVER_ENUM },
        minItems: 1,
        uniqueItems: true,
        description: 'Regenerate only these drivers. Omit for the full run.',
      },
    },
    required: ['audit_id'],
    additionalProperties: false,
  },
  readOnly: false,
  analysisIdOf: auditIdOfArgs,
  async run(args, ctx: McpToolContext) {
    const { audit_id, drivers } = parseArgs(insightsArgs, args, 'generate_insights')
    const json = await invokeObject(
      ctx,
      routes.insightsPost,
      {
        method: 'POST',
        path: auditPath(audit_id, '/insights'),
        params: { id: audit_id },
        body: drivers ? { drivers } : {},
      },
      'generate_insights',
    )
    return {
      data: {
        audit_id,
        status: str(json.status),
        drivers: json.drivers ?? [],
        targeted: json.targeted === true,
        hint: 'Generation runs in the background. Poll get_insights until insightsStatus is "done" or "error".',
      },
    }
  },
}

// ---------------------------------------------------------------------------
// resolve_decision
// ---------------------------------------------------------------------------

const decisionArgs = z.object({
  audit_id: auditIdSchema,
  driver: driverKeySchema,
  decision: z.record(z.unknown(), {
    required_error: 'decision is required (an object, see the tool description)',
    invalid_type_error: 'decision must be an object',
  }),
})

export const resolveDecision: McpTool = {
  name: 'resolve_decision',
  title: 'Resolve driver decision',
  description:
    'Answer the question a PAUSED driver (status needs_decision) is waiting on; get_audit / get_driver show it as decisionRequest. ' +
    'The decision is stored and the driver is re-queued and re-run with it. The decision object depends on the driver: ' +
    '(1) discoverability, a player has no keywords at the current tier: { "tier": "relaxed_2" | "relaxed_3" } widens the thresholds for the whole set (decisionRequest.next_tier says which); ' +
    '{ "removed": ["competitor.com"] } drops competitors from the set (never the client); ' +
    '{ "replace": { "from": "old.com", "to": "new.com", "brand_name": "New" } } swaps a competitor and RE-RUNS THE WHOLE AUDIT (every driver). ' +
    '(2) ai_visibility, waiting for a J-Horizon result: { "jhorizon_answer": "<pasted text>" } or manual scores { "score": 0-100, "competitors": { "domain.com": 0-100 }, "comment": "..." }. ' +
    '(3) content, questionnaire missing: complete the Content questionnaire in the web app first, then send {} here. ' +
    'Refused if the driver is not currently needs_decision (use rerun_drivers to re-measure). ' +
    'Returns whether the job was accepted. Poll get_audit afterwards. ' +
    'Cost: re-measures that driver, so it SPENDS PAID API UNITS of its provider again (see get_driver_catalog); a replace costs the whole audit. ' +
    APPROVAL,
  inputSchema: {
    type: 'object',
    properties: {
      audit_id: AUDIT_ID_PROP,
      driver: { type: 'string', enum: DRIVER_ENUM, description: 'The paused driver.' },
      decision: {
        type: 'object',
        description: 'The answer; its shape depends on the driver (see the tool description). Validated by the server.',
        additionalProperties: true,
      },
    },
    required: ['audit_id', 'driver', 'decision'],
    additionalProperties: false,
  },
  readOnly: false,
  analysisIdOf: auditIdOfArgs,
  async run(args, ctx: McpToolContext) {
    const { audit_id, driver, decision } = parseArgs(decisionArgs, args, 'resolve_decision')
    if (Object.keys(decision).length === 0 && driver !== 'content') {
      throw new McpToolError(
        `resolve_decision: an empty decision is only meaningful for content. For ${driver}, read decisionRequest in get_driver and answer it.`,
      )
    }
    const params = { id: audit_id, key: driver }

    // Mirror the web app, which only offers this form on a paused driver. The
    // route itself would happily requeue a finished driver (and re-spend units).
    const status = await invokeObject(
      ctx,
      routes.status,
      { method: 'GET', path: auditPath(audit_id, '/status'), params: { id: audit_id } },
      'resolve_decision (status)',
    )
    const row = arr(status.drivers).filter(isRecord).find((r) => r.driver_key === driver)
    if (!row) {
      throw new McpToolError(`resolve_decision: driver "${driver}" has no run in this audit.`)
    }
    if (row.status !== 'needs_decision') {
      throw new McpToolError(
        `resolve_decision: driver "${driver}" is "${String(row.status)}", not needs_decision, so there is nothing to answer. ` +
          'To re-measure a driver use rerun_drivers (force: true if it is done).',
      )
    }

    const json = await invokeObject(
      ctx,
      routes.decision,
      { method: 'POST', path: auditPath(audit_id, `/drivers/${driver}/decision`), params, body: { decision } },
      'resolve_decision',
    )
    const dispatch = isRecord(json.dispatch) ? json.dispatch : null
    return {
      data: {
        audit_id,
        driver,
        result: str(json.status),
        ...omitEmpty({
          rerun: str(json.rerun),
          replaced: json.from ? { from: str(json.from), to: str(json.to) } : null,
          drivers: json.status === 'replaced' ? arr(json.drivers) : null,
          dispatchError: dispatch && dispatch.dispatched === false ? str(dispatch.error) : null,
        }),
        hint: 'The driver is re-queued and running in the background. Poll get_audit.',
      },
    }
  },
}

// ---------------------------------------------------------------------------
// set_global_notes
// ---------------------------------------------------------------------------

const MAX_NOTES = 10_000

const notesArgs = z.object({
  audit_id: auditIdSchema,
  notes: z.string({ required_error: 'notes is required (use an empty string to clear)' }).max(MAX_NOTES, `notes must be at most ${MAX_NOTES} characters`),
})

export const setGlobalNotes: McpTool = {
  name: 'set_global_notes',
  title: 'Set global notes',
  description:
    'Replace the global project notes of an audit (free text context from the analyst). They are appended to EVERY insight prompt, ' +
    'so they steer the next generate_insights run; existing insights are not changed. Pass an empty string to clear them. ' +
    `Works at any stage of the audit; max ${MAX_NOTES} characters. The previous notes are overwritten: read them with get_audit first if you need to keep them. ` +
    'Cost: free (no API units). ' +
    APPROVAL,
  inputSchema: {
    type: 'object',
    properties: {
      audit_id: AUDIT_ID_PROP,
      notes: { type: 'string', maxLength: MAX_NOTES, description: 'The full new notes text; empty string clears.' },
    },
    required: ['audit_id', 'notes'],
    additionalProperties: false,
  },
  readOnly: false,
  analysisIdOf: auditIdOfArgs,
  async run(args, ctx: McpToolContext) {
    const { audit_id, notes } = parseArgs(notesArgs, args, 'set_global_notes')
    // The route has a notes-only PATCH shape ({ global_notes } alone), so no
    // read-modify-write of the whole setup is needed.
    const json = await invokeObject(
      ctx,
      routes.analysisPatch,
      { method: 'PATCH', path: auditPath(audit_id), params: { id: audit_id }, body: { global_notes: notes } },
      'set_global_notes',
    )
    return { data: { audit_id, globalNotes: str(json.globalNotes), saved: true } }
  },
}

// ---------------------------------------------------------------------------
// publish_audit
// ---------------------------------------------------------------------------

const publishArgs = z.object({ audit_id: auditIdSchema, rerun: z.boolean().optional() })

export const publishAudit: McpTool = {
  name: 'publish_audit',
  title: 'Save and publish audit',
  description:
    'Save & Publish: stamps every draft analyst edit of the audit as published (the state deliverables are generated from). ' +
    'By default (rerun true) it also re-runs, in one batch, the drivers that have draft edits so their raw data refreshes; the analyst-edited scores and comments survive the re-run. ' +
    'Pass rerun: false to publish without re-measuring. Refused while any driver is still queued or running. ' +
    'Returns editsPublished, publishedAt and the re-run batch (drivers, ineligible, dispatchErrors). ' +
    'Cost: publishing itself is free; with rerun true it SPENDS PAID API UNITS for each driver that has draft edits. ' +
    APPROVAL,
  inputSchema: {
    type: 'object',
    properties: {
      audit_id: AUDIT_ID_PROP,
      rerun: {
        type: 'boolean',
        description: 'Re-run the drivers with draft edits after publishing (default true). false = publish only.',
      },
    },
    required: ['audit_id'],
    additionalProperties: false,
  },
  readOnly: false,
  analysisIdOf: auditIdOfArgs,
  async run(args, ctx: McpToolContext) {
    const { audit_id, rerun } = parseArgs(publishArgs, args, 'publish_audit')
    const json = await invokeObject(
      ctx,
      routes.publish,
      {
        method: 'POST',
        path: auditPath(audit_id, '/publish'),
        params: { id: audit_id },
        body: rerun === undefined ? {} : { rerun },
      },
      'publish_audit',
    )
    const rerunInfo = isRecord(json.rerun) ? json.rerun : null
    return {
      data: {
        audit_id,
        status: str(json.status),
        publishedAt: str(json.publishedAt),
        editsPublished: num(json.editsPublished),
        ...omitEmpty({
          warning: str(json.warning),
          rerun: rerunInfo
            ? omitEmpty({
                drivers: arr(rerunInfo.drivers),
                ineligible: arr(rerunInfo.ineligible),
                dispatchErrors: arr(rerunInfo.dispatchErrors),
              })
            : null,
        }),
        progress: json.progress ?? null,
      },
    }
  },
}

export const WRITE_TOOLS: McpTool[] = [
  createAudit,
  startAudit,
  rerunDrivers,
  generateInsights,
  resolveDecision,
  setGlobalNotes,
  publishAudit,
]
