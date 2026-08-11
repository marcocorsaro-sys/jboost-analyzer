/**
 * V4 LLM insight orchestrator — the narrative engine of the Drivers Bibbia
 * (03), sheets 14 (guardrails), 15 (per-driver prompts) and 16 (sequence,
 * cumulative context, Executive Summary).
 *
 * WHY IT LOOKS LIKE THIS
 * - Sequential by spec, not by accident: sheet 16 A fixes the order
 *   (Awareness -> Discoverability -> Traffic -> Authority -> Compliance ->
 *   Content -> Schema -> Speed -> Accessibility) because each call N receives
 *   the cumulative context of calls 1..N-1 (anti-redundancy + cross-driver
 *   correlations). Parallelising would destroy the contract.
 * - AI Visibility is NOT in the sequence: its paste-driven LLM step already
 *   ran inside the driver itself (lib/v4/drivers/jhorizon-extract.ts). Its
 *   relative comment feeds the cumulative context (sheet 16 B) and its
 *   output feeds the Executive Summary (sheet 16 C), nothing else.
 * - Crash-safe and incremental: every per-driver insight is persisted to
 *   driver_runs.llm_insight the moment it exists. generateInsights() skips
 *   drivers that already have a 'done' insight (idempotent resume) and stops
 *   cooperatively when the time budget runs out, returning { next: true } so
 *   the caller re-dispatches a fresh invocation — up to 9+1 LLM calls do not
 *   fit one Vercel invocation reliably.
 * - Guardrails (sheet 14) are code, not hopes: strict JSON with bounded
 *   retries, em-dash scrub (replace, never reject), hard caps on items, and
 *   a pragmatic anti-hallucination number check (see findInventedNumbers for
 *   its documented limits). A blocked spend limit is a loud 'error' status,
 *   never a silent partial.
 * - The Supabase handle is a parameter (same convention as lib/v4/runner):
 *   that is what lets the whole engine run in tests against a fake client
 *   with a stubbed fetch. getSpendStatus is injected for the same reason —
 *   its module transitively imports lib/supabase/server, whose top-level
 *   react cache() call does not survive the tsx test runner, so the default
 *   is loaded lazily at run time.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DISCO_TIERS, getV4Driver } from '@/lib/scoring/registry'
import {
  callAnthropicWithUsage,
  type AnthropicCallResult,
  type AnthropicCallOptions,
} from '@/lib/v4/drivers/jhorizon-extract'
import { loadAnalysisSites } from '@/lib/v4/runner/store'
import { estimateCost } from '@/lib/tracking/pricing'
import {
  DEFAULT_DRIVER_MODEL,
  DEFAULT_SUMMARY_MODEL,
  DRIVER_CALL_MAX_TOKENS,
  DRIVER_CALL_TEMPERATURE,
  MAX_RETRIES,
  SUMMARY_MAX_TOKENS,
  SUMMARY_TEMPERATURE,
  buildDriverUserPrompt,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  systemPromptFor,
} from './prompts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The driver_runs slice this engine reads (superset-safe vs DriverRunRow). */
export interface InsightRunRow {
  id: string
  driver_key: string
  enabled: boolean
  status: string
  score_absolute: number | null
  score_relative: number | null
  comment_absolute: string | null
  comment_relative: string | null
  tier_used: string | null
  raw_payload: Record<string, unknown>
  llm_insight: LlmInsightRecord | null
}

/** What driver_runs.llm_insight / analyses.v4_executive_summary hold. */
export type LlmInsightRecord =
  | {
      status: 'done'
      output: Record<string, unknown>
      model: string
      generated_at: string
      attempts: number
      /** Sheet 14 anti-hallucination default mode is FLAG: numbers the final
       *  attempt still cited without payload backing, kept visible. */
      hallucination_flags?: string[]
    }
  | { status: 'error'; error: string; model: string; generated_at: string; attempts: number }

/** Sheet 16 B — the two cumulative variables passed between calls. */
export interface CumulativeContext {
  /** { driver_name, items[] } with titolo + ~100 chars of spiegazione. */
  already_mentioned_items: Array<{
    driver_name: string
    items: Array<{ titolo: string; sintesi: string }>
  }>
  /** score + commento_relative compressed to 1 sentence, per driver. */
  other_drivers_context: Array<{ driver: string; score: number | null; commento: string }>
}

export interface GenerateInsightsOptions {
  /** Cooperative time budget; when exceeded the run returns { next: true }. */
  budgetMs?: number
  /** Test seam: replaces the Anthropic call. */
  callModel?: (
    prompt: string,
    what: string,
    options?: AnthropicCallOptions,
  ) => Promise<AnthropicCallResult>
  /** Test seam: replaces getSpendStatus (default lazy-imports the real one). */
  spendStatus?: (db: SupabaseClient) => Promise<{ blocked: boolean; limitEur: number }>
}

export interface GenerateInsightsResult {
  /** True when there is nothing left to do (done OR error). */
  completed: boolean
  /** True when the budget ran out and a new invocation must continue. */
  next: boolean
  status: 'running' | 'done' | 'error'
  processed: string[]
  skippedExisting: string[]
  failed: Array<{ driver: string; error: string }>
  summaryDone: boolean
  error?: string
}

const DEFAULT_BUDGET_MS = 240_000
/** Sheet 15/16 caps on the Executive Summary arrays (3-5, 3-5, max 3). */
const SUMMARY_CAPS: Record<string, number> = {
  correlazioni_chiave: 5,
  priorita_strategiche: 5,
  alert_critici: 3,
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Sheet 16 A: the sequential run = enabled, 'done' driver_runs that have an
 * llmSequence in the registry, in that order. AI Visibility (llmSequence
 * null) never appears here; drivers that failed or paused have no payload to
 * narrate and are simply absent.
 */
export function orderInsightRuns(rows: InsightRunRow[]): InsightRunRow[] {
  return rows
    .filter((r) => {
      if (!r.enabled || r.status !== 'done') return false
      const def = getV4Driver(r.driver_key)
      return !!def && def.llmSequence !== null
    })
    .sort(
      (a, b) => (getV4Driver(a.driver_key)!.llmSequence! - getV4Driver(b.driver_key)!.llmSequence!),
    )
}

/**
 * Robust JSON extraction: take the outermost {...} so a stray code fence or
 * preamble does not fail the parse (same tolerance as parseExtraction in
 * jhorizon-extract.ts).
 */
export function extractJsonObject(
  text: string,
): { value: Record<string, unknown> | null; error: string | null } {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return { value: null, error: 'the response contains no JSON object' }
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: null, error: 'the response JSON is not an object' }
    }
    return { value: parsed as Record<string, unknown>, error: null }
  } catch (err) {
    return { value: null, error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Sheet 14 blocklist rule, the mechanical half: "No em-dashes". The model is
 * told not to use them (system prompt rule 4); when one slips through we
 * REPLACE it with a comma (the sheet's suggested alternatives) instead of
 * burning a retry on a cosmetic fix.
 */
export function stripEmDashesDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\s*—\s*/g, ', ') as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripEmDashesDeep(v)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripEmDashesDeep(v)
    }
    return out as unknown as T
  }
  return value
}

/** ~100 chars of an explanation, for already_mentioned_items (sheet 16 B). */
export function clipChars(text: string, max = 100): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

/** Compress a comment to its first sentence (sheet 16 B update logic c). */
export function firstSentence(text: string): string {
  const t = text.trim()
  const m = t.match(/^.*?[.!?](?=\s|$)/)
  return m ? m[0] : clipChars(t, 160)
}

/**
 * Sheet 14 "Caps": enforce the schema's max items/insights mechanically —
 * 5 for Development items, 3 for Business insights — plus an optional lower
 * cap from the analysis setup (llm_guardrails.max_insights, field #22). A
 * model that over-produces gets truncated, never rejected: the list is
 * ordered by decreasing impact, so the tail is the right thing to lose.
 */
export function applyCaps(
  output: Record<string, unknown>,
  family: 'business' | 'development',
  guardrailMax?: number | null,
): Record<string, unknown> {
  const key = family === 'development' ? 'items' : 'insights'
  const schemaCap = family === 'development' ? 5 : 3
  const cap =
    typeof guardrailMax === 'number' && guardrailMax > 0
      ? Math.min(schemaCap, Math.floor(guardrailMax))
      : schemaCap
  const list = output[key]
  if (Array.isArray(list) && list.length > cap) {
    return { ...output, [key]: list.slice(0, cap) }
  }
  return output
}

/** Same idea for the Executive Summary arrays (5/5/3). */
export function applySummaryCaps(output: Record<string, unknown>): Record<string, unknown> {
  const out = { ...output }
  for (const [key, cap] of Object.entries(SUMMARY_CAPS)) {
    const list = out[key]
    if (Array.isArray(list) && list.length > cap) out[key] = list.slice(0, cap)
  }
  return out
}

/**
 * Numeric tokens of a text, each expanded to its plausible readings so the
 * check is separator-agnostic: "12,847" (en), "12.847" (it) and "12847" all
 * canonicalize to 12847; "4.2" / "4,2" to 4.2.
 */
function numericReadings(token: string): number[] {
  const out = new Set<number>()
  const digitsOnly = Number(token.replace(/[.,]/g, ''))
  if (Number.isFinite(digitsOnly)) out.add(digitsOnly)
  const enStyle = Number(token.replace(/,/g, ''))
  if (Number.isFinite(enStyle)) out.add(enStyle)
  const itStyle = Number(token.replace(/\./g, '').replace(/,/g, '.'))
  if (Number.isFinite(itStyle)) out.add(itStyle)
  return [...out]
}

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/g

/**
 * Sheet 14 anti-hallucination check, the pragmatic version: every number the
 * model wrote in a string field must exist in the source payload it was given.
 *
 * Implementation: collect every numeric reading present in the allowed
 * sources (payload JSON + cumulative context, since rule 12 explicitly lets
 * the model cite other drivers' scores from other_drivers_context); then flag
 * each generated token whose readings are ALL absent and whose value is > 10.
 *
 * DOCUMENTED LIMITS (a check, not a proof):
 * - numbers <= 10 are never flagged (priorities, small counts, the 3/6/12
 *   month horizons would drown the signal in false positives);
 * - a number the model derived arithmetically (e.g. a computed 38% gap
 *   between two payload values) is flagged even though it may be sound;
 * - a hallucinated number that HAPPENS to equal any payload number passes;
 * - only string fields are scanned; numeric JSON fields (scores the schema
 *   itself asks to echo) are trusted to the schema.
 * Default mode is FLAG (sheet 14): the orchestrator retries with guidance
 * while attempts remain, then keeps the output with hallucination_flags set.
 */
export function findInventedNumbers(
  output: Record<string, unknown>,
  allowedSources: string[],
): string[] {
  const allowed = new Set<number>()
  for (const source of allowedSources) {
    for (const token of source.match(NUMBER_TOKEN) ?? []) {
      for (const reading of numericReadings(token)) allowed.add(reading)
    }
  }

  const flagged = new Set<string>()
  const scan = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const token of value.match(NUMBER_TOKEN) ?? []) {
        const readings = numericReadings(token)
        if (readings.length === 0) continue
        if (Math.min(...readings) <= 10) continue
        if (!readings.some((r) => allowed.has(r))) flagged.add(token)
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach(scan)
      return
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(scan)
    }
  }
  scan(output)
  return [...flagged]
}

/**
 * Sheet 16 B update logic: after each call, (b) append item titles + ~100
 * chars of each explanation to already_mentioned_items, (c) append score +
 * the 1-sentence commento_relative to other_drivers_context.
 */
export function updateCumulative(
  ctx: CumulativeContext,
  driverName: string,
  output: Record<string, unknown>,
  score: number | null,
): void {
  const list = (Array.isArray(output.items) ? output.items : null) ??
    (Array.isArray(output.insights) ? output.insights : [])
  const items = (list as Array<Record<string, unknown>>)
    .filter((it) => typeof it?.titolo === 'string')
    .map((it) => ({
      titolo: String(it.titolo),
      sintesi: clipChars(typeof it.spiegazione === 'string' ? it.spiegazione : ''),
    }))
  ctx.already_mentioned_items.push({ driver_name: driverName, items })

  const comment = typeof output.commento_relative === 'string' ? output.commento_relative : ''
  ctx.other_drivers_context.push({
    driver: driverName,
    score,
    commento: firstSentence(comment),
  })
}

/**
 * Sheet 16 B: "AI Visibility, when enabled, also contributes its relative
 * comment to this context (added after its paste-step)". The run's stored
 * comment_relative (written by the paste-driven extraction) is what enters
 * both cumulative variables; if the paste-step has not happened there is
 * nothing to contribute and the sequence simply starts empty.
 */
export function seedAiVisibilityContext(ctx: CumulativeContext, rows: InsightRunRow[]): void {
  const av = rows.find((r) => r.driver_key === 'ai_visibility' && r.enabled && r.status === 'done')
  if (!av || !av.comment_relative?.trim()) return
  ctx.already_mentioned_items.push({
    driver_name: 'AI Visibility',
    items: [{ titolo: 'AI Visibility, commento relativo', sintesi: clipChars(av.comment_relative) }],
  })
  ctx.other_drivers_context.push({
    driver: 'AI Visibility',
    score: av.score_relative,
    commento: firstSentence(av.comment_relative),
  })
}

/** Rebuild the cumulative context from already-persisted insights (resume). */
export function replayPersistedInsights(ctx: CumulativeContext, ordered: InsightRunRow[]): void {
  for (const run of ordered) {
    if (run.llm_insight?.status === 'done') {
      const def = getV4Driver(run.driver_key)!
      updateCumulative(ctx, def.label, run.llm_insight.output, run.score_relative)
    }
  }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

interface AnalysisRow {
  id: string
  domain: string | null
  industry_preset: string | null
  country: string | null
  output_language: string | null
  user_id: string | null
  client_id: string | null
  llm_guardrails: Record<string, unknown> | null
  v4_executive_summary: Record<string, unknown> | null
}

const RUN_SELECT =
  'id, driver_key, enabled, status, score_absolute, score_relative, ' +
  'comment_absolute, comment_relative, tier_used, raw_payload, llm_insight'

async function defaultSpendStatus(db: SupabaseClient): Promise<{ blocked: boolean; limitEur: number }> {
  // Lazy import: lib/tracking/spend-limit transitively imports
  // lib/supabase/server (react cache() at module top level), which must not
  // load when this module is imported by the test runner.
  const { getSpendStatus } = await import('@/lib/tracking/spend-limit')
  return getSpendStatus(db)
}

/** Non-blocking llm_usage insert through the SAME (service-role) handle the
 *  engine already holds — trackLlmUsage builds a cookie-scoped client, which
 *  does not exist inside the secret-authenticated continuation route. Same
 *  row shape and cost source (lib/tracking/pricing) as trackLlmUsage. */
async function logUsage(
  db: SupabaseClient,
  analysis: AnalysisRow,
  operation: string,
  call: AnthropicCallResult,
  attempt: number,
): Promise<void> {
  try {
    await db.from('llm_usage').insert({
      user_id: analysis.user_id,
      client_id: analysis.client_id,
      provider: 'anthropic',
      model: call.model,
      operation,
      input_tokens: call.inputTokens,
      output_tokens: call.outputTokens,
      estimated_cost_usd: estimateCost(call.model, call.inputTokens, call.outputTokens),
      metadata: { analysis_id: analysis.id, attempt },
    })
  } catch (err) {
    console.error('[v4/llm] llm_usage insert failed:', err)
  }
}

interface AttemptResult {
  output: Record<string, unknown> | null
  error: string | null
  attempts: number
  model: string
  hallucinationFlags: string[]
}

/**
 * One guarded generation: call -> parse -> scrub -> cap -> number-check, with
 * up to MAX_RETRIES guided retries (sheet 15 A). Invalid JSON always retries;
 * invented numbers retry while attempts remain and are FLAGGED on the last
 * one (sheet 14 default mode). The spend limit is re-checked before every
 * single call, not once per driver: a cap crossed mid-retry must stop us.
 */
async function guardedGenerate(args: {
  db: SupabaseClient
  analysis: AnalysisRow
  what: string
  operation: string
  system: string
  userPrompt: string
  model: string
  maxTokens: number
  temperature: number
  family: 'business' | 'development' | null
  allowedNumberSources: string[]
  summaryCaps?: boolean
  guardrailMax?: number | null
  callModel: NonNullable<GenerateInsightsOptions['callModel']>
  spendStatus: NonNullable<GenerateInsightsOptions['spendStatus']>
}): Promise<AttemptResult | { spendBlocked: string }> {
  let guidance = ''
  let lastError = 'no attempt ran'

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const spend = await args.spendStatus(args.db)
    if (spend.blocked) {
      return {
        spendBlocked:
          `limite di spesa LLM giornaliero raggiunto (€${spend.limitEur.toFixed(2)}/giorno) ` +
          `durante "${args.what}": generazione insight interrotta`,
      }
    }

    let call: AnthropicCallResult
    try {
      call = await args.callModel(args.userPrompt + guidance, args.what, {
        model: args.model,
        maxTokens: args.maxTokens,
        temperature: args.temperature,
        system: args.system,
        timeoutMs: 120_000,
      })
    } catch (err) {
      // Transport/API failure: no output to retry against. Surface it as the
      // driver's own error; a later re-run retries it (llm_insight stays
      // resumable because only 'done' is skipped).
      return {
        output: null,
        error: err instanceof Error ? err.message : String(err),
        attempts: attempt,
        model: args.model,
        hallucinationFlags: [],
      }
    }
    await logUsage(args.db, args.analysis, args.operation, call, attempt)

    const { value, error: parseError } = extractJsonObject(call.text)
    if (!value) {
      lastError = parseError ?? 'unparsable output'
      guidance =
        `\n\nYOUR PREVIOUS RESPONSE WAS REJECTED: ${lastError}. ` +
        'Return ONLY one valid JSON object matching the schema. No markdown, no backticks, no text outside the JSON.'
      continue
    }

    let output = stripEmDashesDeep(value)
    if (args.summaryCaps) output = applySummaryCaps(output)
    else if (args.family) output = applyCaps(output, args.family, args.guardrailMax)

    const invented = findInventedNumbers(output, args.allowedNumberSources)
    if (invented.length > 0 && attempt <= MAX_RETRIES) {
      guidance =
        `\n\nYOUR PREVIOUS RESPONSE WAS REJECTED: it cited numbers that do not exist in the data ` +
        `provided (${invented.join(', ')}). Cite ONLY numbers present in the payload or in ` +
        'other_drivers_context. Return the full corrected JSON object.'
      continue
    }

    return { output, error: null, attempts: attempt, model: call.model, hallucinationFlags: invented }
  }

  return {
    output: null,
    error: `unparsable JSON after ${MAX_RETRIES + 1} attempts: ${lastError}`,
    attempts: MAX_RETRIES + 1,
    model: args.model,
    hallucinationFlags: [],
  }
}

/**
 * Run (or resume) the whole insights orchestration for one analysis.
 *
 * Incremental contract: processes drivers in sheet 16 A order while the time
 * budget lasts, persisting each insight immediately; returns
 * { completed: false, next: true } when work remains, and the caller (the
 * secret-authenticated continuation route) re-dispatches itself until
 * completed. Idempotent: drivers whose llm_insight is already 'done' are
 * skipped (their output only replays into the cumulative context), and an
 * already-stored Executive Summary is never regenerated.
 */
export async function generateInsights(
  db: SupabaseClient,
  analysisId: string,
  options: GenerateInsightsOptions = {},
): Promise<GenerateInsightsResult> {
  const t0 = Date.now()
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
  const callModel = options.callModel ?? callAnthropicWithUsage
  const spendStatus = options.spendStatus ?? defaultSpendStatus

  const result: GenerateInsightsResult = {
    completed: false,
    next: false,
    status: 'running',
    processed: [],
    skippedExisting: [],
    failed: [],
    summaryDone: false,
  }

  const fail = async (message: string): Promise<GenerateInsightsResult> => {
    await db
      .from('analyses')
      .update({ v4_insights_status: 'error', v4_insights_error: message })
      .eq('id', analysisId)
    return { ...result, completed: true, next: false, status: 'error', error: message }
  }

  // --- Load the analysis + its runs -------------------------------------
  const { data: analysisData, error: analysisError } = await db
    .from('analyses')
    .select(
      'id, domain, industry_preset, country, output_language, user_id, client_id, llm_guardrails, v4_executive_summary',
    )
    .eq('id', analysisId)
    .single()
  if (analysisError || !analysisData) {
    return fail(`analysis not found: ${analysisError?.message ?? analysisId}`)
  }
  const analysis = analysisData as AnalysisRow

  const { data: runData, error: runsError } = await db
    .from('driver_runs')
    .select(RUN_SELECT)
    .eq('analysis_id', analysisId)
  if (runsError) return fail(`driver_runs read failed: ${runsError.message}`)
  const rows = (runData ?? []) as unknown as InsightRunRow[]

  const ordered = orderInsightRuns(rows)
  if (ordered.length === 0) {
    return fail('no completed LLM-sequence driver to narrate (sheet 16 A)')
  }

  // --- Model configuration (app_config, same pattern as daily_spend_limit) --
  const { data: cfgRows } = await db
    .from('app_config')
    .select('key, value')
    .in('key', ['v4_llm_driver_model', 'v4_llm_summary_model'])
  const cfg = Object.fromEntries(
    ((cfgRows ?? []) as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]),
  )
  const driverModel = cfg.v4_llm_driver_model || DEFAULT_DRIVER_MODEL
  const summaryModel = cfg.v4_llm_summary_model || DEFAULT_SUMMARY_MODEL

  const outputLanguage = analysis.output_language ?? 'it'
  const domain = analysis.domain ?? ''
  const guardrails = (analysis.llm_guardrails ?? {}) as { max_insights?: unknown }
  const guardrailMax =
    typeof guardrails.max_insights === 'number' ? guardrails.max_insights : null

  // --- Cumulative context: AI Visibility seed + replay of persisted work --
  const ctx: CumulativeContext = { already_mentioned_items: [], other_drivers_context: [] }
  seedAiVisibilityContext(ctx, rows)
  replayPersistedInsights(ctx, ordered)

  // --- The sequential per-driver calls (sheet 16 A/B) ---------------------
  for (const run of ordered) {
    if (run.llm_insight?.status === 'done') {
      result.skippedExisting.push(run.driver_key)
      continue // context already replayed above
    }
    if (Date.now() - t0 > budgetMs) {
      return { ...result, completed: false, next: true, status: 'running' }
    }

    const def = getV4Driver(run.driver_key)!
    const tier =
      run.driver_key === 'discoverability'
        ? (DISCO_TIERS.find((t) => t.key === run.tier_used) ?? DISCO_TIERS[0])
        : null

    // The driver payload the model sees: the sheet-7 raw payload plus the
    // scores of the two views (both are inputs the schema asks to echo).
    const payloadJson = JSON.stringify({
      score_relative: run.score_relative,
      ...(def.family === 'development' ? { score_absolute: run.score_absolute } : {}),
      tier_used: run.tier_used,
      payload: run.raw_payload,
    })
    const otherCtxJson = JSON.stringify(ctx.other_drivers_context)
    const alreadyJson = JSON.stringify(ctx.already_mentioned_items)

    const generated = await guardedGenerate({
      db,
      analysis,
      what: `V4 insight ${def.label}`,
      operation: `v4_driver_insight_${run.driver_key}`,
      system: systemPromptFor(def.family, outputLanguage),
      userPrompt: buildDriverUserPrompt({
        driverKey: run.driver_key,
        driverName: def.label,
        family: def.family,
        domain,
        industryPreset: analysis.industry_preset,
        outputLanguage,
        score: run.score_relative,
        driverPayloadJson: payloadJson,
        otherDriversContextJson: otherCtxJson,
        alreadyMentionedItemsJson: alreadyJson,
        tier,
      }),
      model: driverModel,
      maxTokens: DRIVER_CALL_MAX_TOKENS,
      temperature: DRIVER_CALL_TEMPERATURE,
      family: def.family,
      allowedNumberSources: [payloadJson, otherCtxJson],
      guardrailMax,
      callModel,
      spendStatus,
    })

    if ('spendBlocked' in generated) return fail(generated.spendBlocked)

    const record: LlmInsightRecord = generated.output
      ? {
          status: 'done',
          output: generated.output,
          model: generated.model,
          generated_at: new Date().toISOString(),
          attempts: generated.attempts,
          ...(generated.hallucinationFlags.length > 0
            ? { hallucination_flags: generated.hallucinationFlags }
            : {}),
        }
      : {
          status: 'error',
          error: generated.error ?? 'unknown generation failure',
          model: generated.model,
          generated_at: new Date().toISOString(),
          attempts: generated.attempts,
        }

    // Persist IMMEDIATELY: this is the crash-safe resume point.
    const { error: writeError } = await db
      .from('driver_runs')
      .update({ llm_insight: record })
      .eq('id', run.id)
    if (writeError) return fail(`llm_insight write failed for ${run.driver_key}: ${writeError.message}`)

    if (record.status === 'done') {
      result.processed.push(run.driver_key)
      updateCumulative(ctx, def.label, record.output, run.score_relative)
      run.llm_insight = record
    } else {
      result.failed.push({ driver: run.driver_key, error: record.error })
      run.llm_insight = record
    }
  }

  // --- Final call: Executive Summary (sheet 16 C) -------------------------
  if (analysis.v4_executive_summary) {
    result.summaryDone = true // idempotent: never regenerate a stored summary
  } else {
    if (Date.now() - t0 > budgetMs) {
      return { ...result, completed: false, next: true, status: 'running' }
    }

    const doneRuns = rows.filter((r) => r.enabled && r.status === 'done')
    const scoreSummary = doneRuns.map((r) => ({
      driver: getV4Driver(r.driver_key)?.label ?? r.driver_key,
      score_relative: r.score_relative,
      score_absolute: r.score_absolute,
    }))

    // "It receives the outputs of all enabled drivers (up to 10)": the 9
    // sequential outputs plus AI Visibility's paste-step comments.
    const allOutputs: Record<string, unknown> = {}
    for (const run of ordered) {
      if (run.llm_insight?.status === 'done') {
        allOutputs[getV4Driver(run.driver_key)!.label] = run.llm_insight.output
      }
    }
    const av = rows.find((r) => r.driver_key === 'ai_visibility' && r.enabled && r.status === 'done')
    if (av) {
      allOutputs['AI Visibility'] = {
        score_relative: av.score_relative,
        score_absolute: av.score_absolute,
        commento_absolute: av.comment_absolute,
        commento_relative: av.comment_relative,
      }
    }
    if (Object.keys(allOutputs).length === 0) {
      return fail('nessun insight driver generato: Executive Summary impossibile')
    }

    const { sites } = await loadAnalysisSites(db, analysisId)
    const competitorsJson = JSON.stringify(
      sites.filter((s) => !s.is_client).map((s) => ({ name: s.name, domain: s.domain })),
    )
    const scoreSummaryJson = JSON.stringify(scoreSummary)
    const allOutputsJson = JSON.stringify(allOutputs)

    const generated = await guardedGenerate({
      db,
      analysis,
      what: 'V4 Executive Summary',
      operation: 'v4_executive_summary',
      system: buildSummarySystemPrompt(outputLanguage),
      userPrompt: buildSummaryUserPrompt({
        domain,
        industryPreset: analysis.industry_preset,
        country: analysis.country,
        outputLanguage,
        driversScoreSummaryJson: scoreSummaryJson,
        allDriversOutputJson: allOutputsJson,
        competitorsSummaryJson: competitorsJson,
      }),
      model: summaryModel,
      maxTokens: SUMMARY_MAX_TOKENS,
      temperature: SUMMARY_TEMPERATURE,
      family: null,
      summaryCaps: true,
      allowedNumberSources: [scoreSummaryJson, allOutputsJson, competitorsJson],
      callModel,
      spendStatus,
    })

    if ('spendBlocked' in generated) return fail(generated.spendBlocked)
    if (!generated.output) {
      return fail(`Executive Summary failed: ${generated.error ?? 'unknown'}`)
    }

    const summaryRecord: LlmInsightRecord = {
      status: 'done',
      output: generated.output,
      model: generated.model,
      generated_at: new Date().toISOString(),
      attempts: generated.attempts,
      ...(generated.hallucinationFlags.length > 0
        ? { hallucination_flags: generated.hallucinationFlags }
        : {}),
    }
    const { error: summaryWriteError } = await db
      .from('analyses')
      .update({ v4_executive_summary: summaryRecord })
      .eq('id', analysisId)
    if (summaryWriteError) return fail(`executive summary write failed: ${summaryWriteError.message}`)
    result.summaryDone = true
  }

  // --- Terminal state. Driver-level failures are a visible warning, never a
  //     silent partial: they land in v4_insights_error next to status 'done'.
  const warning =
    result.failed.length > 0
      ? `insight non generati per: ${result.failed.map((f) => `${f.driver} (${f.error})`).join('; ')}`
      : null
  const { error: statusError } = await db
    .from('analyses')
    .update({ v4_insights_status: 'done', v4_insights_error: warning })
    .eq('id', analysisId)
  if (statusError) {
    return { ...result, completed: true, next: false, status: 'done', error: statusError.message }
  }

  return { ...result, completed: true, next: false, status: 'done' }
}
