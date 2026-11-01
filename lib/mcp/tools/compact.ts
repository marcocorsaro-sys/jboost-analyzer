/**
 * MCP tools — pure reshaping of the V4 route payloads into compact answers.
 *
 * The status route returns every driver row with per-site evidence; the
 * insights route returns whole LLM records. An LLM context does not need
 * that volume: scores, statuses, per-site values, the failure reason, a
 * trimmed evidence summary and the insight text are enough. Everything here
 * is pure so it is unit-tested without Next or Supabase.
 */

import { getV4Driver } from '@/lib/scoring/registry'
import {
  DECISION_TRIM,
  EVIDENCE_TRIM,
  TEXT_TRIM,
  arr,
  capList,
  clip,
  isRecord,
  num,
  omitEmpty,
  str,
  trimJson,
} from '@/lib/mcp/tools/shared'

/** Most per-site rows / unmeasured rows kept per driver. */
const MAX_SITES = 10
const MAX_ERROR_CHARS = 700

// ---------------------------------------------------------------------------
// Decision requests (the question a paused driver asks the analyst)
// ---------------------------------------------------------------------------

/**
 * Short form for the audit overview: what the driver is asking and which
 * answers are possible. The long copy-prompt stays out (get_driver has it).
 */
export function summarizeDecisionRequest(request: unknown): Record<string, unknown> | null {
  if (!isRecord(request)) return null
  const message = str(request.message)
  return omitEmpty({
    reason: str(request.reason),
    message: message ? clip(message, 600) : null,
    options: Array.isArray(request.options) ? request.options : null,
    tier: str(request.tier),
    next_tier: str(request.next_tier),
    empty_players: Array.isArray(request.empty_players) ? request.empty_players : null,
    removable_players: Array.isArray(request.removable_players) ? request.removable_players : null,
    client_domain: str(request.client_domain),
  })
}

// ---------------------------------------------------------------------------
// Per-driver rows
// ---------------------------------------------------------------------------

function driverMeta(key: string): { label: string; family: string | null } {
  const def = getV4Driver(key)
  return { label: def?.label ?? key, family: def?.family ?? null }
}

function unmeasuredList(row: Record<string, unknown>): Array<{ domain: string; reason: string | null }> {
  return arr(row.unmeasured_details)
    .filter(isRecord)
    .slice(0, MAX_SITES)
    .map((d) => ({ domain: str(d.domain) ?? '?', reason: str(d.reason) }))
}

/** One line per driver for get_audit. */
export function compactDriverSummary(row: Record<string, unknown>): Record<string, unknown> {
  const key = str(row.driver_key) ?? '?'
  const meta = driverMeta(key)
  const error = str(row.error)
  const partial = str(row.partial_note)
  const unmeasured = unmeasuredList(row)
  return {
    driver: key,
    label: meta.label,
    family: meta.family,
    status: str(row.status),
    enabled: row.enabled !== false,
    scoreAbsolute: num(row.score_absolute),
    scoreRelative: num(row.score_relative),
    ...omitEmpty({
      rawValue: num(row.raw_value),
      tierUsed: str(row.tier_used),
      edited: row.edited === true ? true : null,
      attempts: num(row.attempts),
      maxAttempts: num(row.max_attempts),
      failureReason: error ? clip(error, MAX_ERROR_CHARS) : null,
      partialNote: partial ? clip(partial, 400) : null,
      unmeasured,
      decisionRequest: summarizeDecisionRequest(row.decision_request),
    }),
  }
}

/** Per-site values of one driver; evidence trimmed hard. */
export function compactSites(rawSites: unknown): { sites: Array<Record<string, unknown>>; truncated: boolean } {
  const list = capList(arr(rawSites).filter(isRecord), MAX_SITES)
  let truncated = list.truncated
  const sites = list.items.map((s) => {
    const evidence = s.evidence === undefined ? null : trimJson(s.evidence, EVIDENCE_TRIM)
    if (evidence?.truncated) truncated = true
    return {
      site_ref: str(s.site_ref),
      domain: str(s.domain),
      raw: num(s.raw),
      scoreAbsolute: num(s.score_absolute),
      scoreRelative: num(s.score_relative),
      rank: num(s.rank),
      ...omitEmpty({ evidence: evidence?.value ?? null }),
    }
  })
  return { sites, truncated }
}

function attachmentList(value: unknown): Array<{ kind: string | null; path: string | null }> {
  return arr(value)
    .filter(isRecord)
    .slice(0, 10)
    .map((a) => ({ kind: str(a.kind), path: str(a.path) ?? str(a.name) }))
}

/** Everything get_driver returns about the measurement (insight is added by the tool). */
export function compactDriverDetail(row: Record<string, unknown>): {
  driver: Record<string, unknown>
  truncated: boolean
} {
  const summary = compactDriverSummary(row)
  const { sites, truncated: sitesTruncated } = compactSites(row.sites)
  let truncated = sitesTruncated

  // The detail view keeps the full question, including the J-Horizon copy
  // prompt, because the human may have to answer it.
  let decisionRequest: unknown = null
  if (isRecord(row.decision_request)) {
    const trimmed = trimJson(row.decision_request, DECISION_TRIM)
    decisionRequest = trimmed.value
    if (trimmed.truncated) truncated = true
  }

  const commentAbsolute = str(row.comment_absolute)
  const commentRelative = str(row.comment_relative)
  const psi = isRecord(row.psi_plan) ? row.psi_plan : null

  const driver = {
    ...summary,
    ...omitEmpty({
      decisionRequest,
      commentAbsolute: commentAbsolute ? clip(commentAbsolute, 1200) : null,
      commentRelative: commentRelative ? clip(commentRelative, 1200) : null,
      startedAt: str(row.started_at),
      completedAt: str(row.completed_at),
      psiPlan: psi,
      attachments: attachmentList(row.attachments),
    }),
    sites,
  }
  return { driver, truncated }
}

/** Sort driver rows in the registry's display order (Business first). */
export function sortDriverRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const order = (row: Record<string, unknown>): number => getV4Driver(str(row.driver_key) ?? '')?.uiOrder ?? 99
  return [...rows].sort((a, b) => order(a) - order(b))
}

// ---------------------------------------------------------------------------
// LLM insights
// ---------------------------------------------------------------------------

/** One stored LLM record (driver insight or executive summary), compacted. */
export function compactInsight(record: unknown): { insight: Record<string, unknown> | null; truncated: boolean } {
  if (!isRecord(record)) return { insight: null, truncated: false }
  const status = str(record.status)
  if (status === 'error') {
    const error = str(record.error)
    return {
      insight: omitEmpty({
        status,
        error: error ? clip(error, MAX_ERROR_CHARS) : null,
        model: str(record.model),
        generatedAt: str(record.generated_at),
      }),
      truncated: false,
    }
  }
  const output = trimJson(record.output ?? null, TEXT_TRIM)
  const flags = capList(arr(record.hallucination_flags).filter((f): f is string => typeof f === 'string'), 10)
  return {
    insight: omitEmpty({
      status,
      model: str(record.model),
      generatedAt: str(record.generated_at),
      degraded: record.json_degraded === true ? true : null,
      repaired: record.json_repaired === true ? true : null,
      hallucinationFlags: flags.items,
      output: output.value,
    }),
    truncated: output.truncated || flags.truncated,
  }
}
