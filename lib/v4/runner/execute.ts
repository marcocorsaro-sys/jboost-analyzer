/**
 * V4 runner — job execution (the only place the pieces meet).
 *
 * One call = one driver job = one Vercel invocation:
 *
 *   claim (atomic, leased)  ->  load sites  ->  run the worker
 *                                                    |
 *   persist the outcome  <---------------------------+
 *          |
 *   re-normalize the analysis (leader-index is a property of the SET, so
 *   every landing driver refreshes everyone's relative score)
 *
 * Nothing here decides *how* a driver is measured — that is the worker's job
 * (lib/v4/runner/workers.ts). Nothing here decides *what* a score is — that is
 * Block 1 (lib/scoring/leader-index). This module only moves a job through the
 * state machine and is honest about failure at every step.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorker } from './workers'
import { normalizeAnalysis, summarizeProgress } from './normalize'
import { selectStaleRuns, selectUndispatchedRuns } from './reaper'
import { dispatchDriverJob } from './dispatch'
import {
  claimDriverRun,
  listDriverRuns,
  listRunningRuns,
  listUndispatchedRuns,
  loadAnalysisSites,
  loadContentAnswers,
  loadTemplateConfigs,
  markDispatched,
  updateDriverRun,
} from './store'
import type { DriverJobContext, DriverJobOutcome } from './types'

/** Lease length. Must exceed the route's maxDuration, or the reaper races a live worker. */
export const DEFAULT_LEASE_SECS = 330

/** Leave this much of the invocation budget for persisting the outcome. */
const WRITEBACK_RESERVE_MS = 15_000

export interface ExecuteResult {
  claimed: boolean
  /** Why nothing ran: already running elsewhere, out of attempts, not queued. */
  skippedReason?: string
  status?: DriverJobOutcome['status'] | 'queued'
  error?: string
  /** True when this job was put back in the queue for another attempt. */
  requeued?: boolean
}

export interface ExecuteOptions {
  leaseSecs?: number
  /** Absolute ms deadline handed to the worker so it can stop cooperatively. */
  deadlineAt?: number
}

export async function executeDriverJob(
  db: SupabaseClient,
  analysisId: string,
  driverKey: string,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const leaseSecs = options.leaseSecs ?? DEFAULT_LEASE_SECS
  const deadlineAt = options.deadlineAt ?? Date.now() + leaseSecs * 1000 - WRITEBACK_RESERVE_MS

  // 1. Claim. The Postgres function is the concurrency guard: a second
  //    dispatcher for the same driver gets zero rows and leaves quietly.
  const { row, error: claimError } = await claimDriverRun(db, analysisId, driverKey, leaseSecs)
  if (claimError) return { claimed: false, error: claimError }
  if (!row) {
    return {
      claimed: false,
      skippedReason:
        'nothing to claim: the job is already running, disabled, finished, or out of attempts',
    }
  }

  // 2. The worker must exist. An unknown key means the registry and the
  //    seeded rows disagree — a bug, not a measurement failure.
  const worker = getWorker(driverKey)
  if (!worker) {
    await writeOutcome(db, row.id, {
      status: 'error',
      error: `no worker registered for driver "${driverKey}"`,
    })
    return { claimed: true, status: 'error', error: 'no worker registered' }
  }

  // 3. Site set. A driver measures the whole set, never a single domain.
  const { sites, refDate, country, error: sitesError } = await loadAnalysisSites(db, analysisId)
  if (sitesError || sites.length === 0) {
    await writeOutcome(db, row.id, {
      status: 'error',
      error: sitesError ?? 'analysis has no sites to measure',
    })
    return { claimed: true, status: 'error', error: sitesError ?? 'no sites' }
  }

  // Templates are shared across the page-based drivers; loading them here
  // keeps workers free of any DB handle.
  const { templates } = await loadTemplateConfigs(db, analysisId)

  // Questionnaire answers are Content's single source (sheets 9a/9b); no
  // other driver reads them, so they are loaded only for that one job.
  let contentAnswers: DriverJobContext['contentAnswers']
  if (row.driver_key === 'content') {
    const { answers, error: answersError } = await loadContentAnswers(db, analysisId)
    if (answersError) {
      // A failed read must NOT masquerade as "questionnaire not filled":
      // the worker would pause on needs_decision and ask the analyst to
      // redo work that may already exist. Fail the run instead, retryable
      // through the normal attempt cycle.
      const retryable = row.attempts < row.max_attempts
      await writeOutcome(
        db,
        row.id,
        { status: 'error', error: `content_answers read failed: ${answersError}` },
        retryable,
      )
      return { claimed: true, status: retryable ? 'queued' : 'error', requeued: retryable, error: answersError }
    }
    contentAnswers = answers
  }

  const ctx: DriverJobContext = {
    analysisId,
    driverKey: row.driver_key,
    sites,
    templates,
    contentAnswers,
    config: row.config ?? {},
    refDate,
    country,
    decisionTaken: row.decision_taken ?? null,
    deadlineAt,
  }

  // 4. Run. A worker that throws is treated exactly like one that returns
  //    an error outcome — never as a zero, never as a silent success.
  let outcome: DriverJobOutcome
  try {
    outcome = await worker(ctx)
  } catch (err) {
    outcome = {
      status: 'error',
      error: `worker threw: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // 5. Persist. A retryable error goes back to 'queued' so the next dispatch
  //    (or the cron reaper) picks it up; attempts is already incremented by
  //    the claim, so this converges to 'error' after max_attempts.
  const retryable = outcome.status === 'error' && row.attempts < row.max_attempts
  const { error: writeError } = await writeOutcome(db, row.id, outcome, retryable)
  if (writeError) return { claimed: true, status: outcome.status, error: writeError }

  // 6. Re-normalize: a new raw changes every site's leader-index score.
  if (outcome.status === 'done') {
    await renormalizeAnalysis(db, analysisId)
  }

  return {
    claimed: true,
    status: retryable ? 'queued' : outcome.status,
    requeued: retryable,
    error: outcome.status === 'error' ? outcome.error : undefined,
  }
}

/** Map a worker outcome onto driver_runs columns. The worker never does this itself. */
async function writeOutcome(
  db: SupabaseClient,
  runId: string,
  outcome: DriverJobOutcome,
  retryable = false,
): Promise<{ error: string | null }> {
  const nowIso = new Date().toISOString()
  const base: Record<string, unknown> = {
    // Releasing the lease is what tells the reaper this job is not abandoned.
    lease_expires_at: null,
  }

  if (outcome.status === 'done') {
    return updateDriverRun(db, runId, {
      ...base,
      status: 'done',
      error: null,
      tier_used: outcome.tierUsed ?? null,
      completed_at: nowIso,
      // Per-site raws live here; normalizeAnalysis reads them back and adds
      // the scores. raw_value/score_* are filled by that pass, not this one.
      raw_payload: { ...(outcome.rawPayload ?? {}), sites: outcome.sites },
    })
  }

  if (outcome.status === 'needs_decision') {
    return updateDriverRun(db, runId, {
      ...base,
      status: 'needs_decision',
      error: null,
      decision_request: outcome.decisionRequest,
      raw_payload: outcome.rawPayload ?? {},
    })
  }

  return updateDriverRun(db, runId, {
    ...base,
    status: retryable ? 'queued' : 'error',
    error: outcome.error,
    completed_at: retryable ? null : nowIso,
    raw_payload: outcome.rawPayload ?? {},
  })
}

/**
 * Recompute the leader-index across every completed driver of the analysis.
 *
 * Safe to call at any time and from any number of concurrent jobs: it reads
 * the current rows and writes derived columns only, so the worst case of a
 * race is one redundant recompute with the same inputs.
 */
export async function renormalizeAnalysis(
  db: SupabaseClient,
  analysisId: string,
): Promise<{ updated: number; error: string | null }> {
  const { rows, error } = await listDriverRuns(db, analysisId)
  if (error) return { updated: 0, error }

  const updates = normalizeAnalysis(rows)
  const normalizedAt = new Date().toISOString()

  for (const u of updates) {
    const { error: updateError } = await updateDriverRun(db, u.id, {
      raw_value: u.raw_value,
      score_relative: u.score_relative,
      score_absolute: u.score_absolute,
      raw_payload: { ...u.raw_payload, normalized_at: normalizedAt },
    })
    if (updateError) return { updated: 0, error: updateError }
  }

  return { updated: updates.length, error: null }
}

export interface ReapSummary {
  requeued: number
  failed: number
  redispatched: number
  errors: string[]
}

/**
 * Cron-side recovery pass (reuse map §6 — hosted by the existing cron, no new
 * infrastructure).
 *
 * Two distinct failure modes, two distinct signals:
 *   - 'running' with an expired lease  -> the invocation died mid-job
 *   - 'queued' and never dispatched    -> the fan-out HTTP call failed
 *
 * Both end the same way: back in the queue and re-dispatched, or marked
 * 'error' with the real reason once attempts run out. Never silently dropped.
 */
export async function reapStaleRuns(
  db: SupabaseClient,
  baseUrl: string,
  now: Date = new Date(),
): Promise<ReapSummary> {
  const summary: ReapSummary = { requeued: 0, failed: 0, redispatched: 0, errors: [] }

  const { rows: running, error: runningError } = await listRunningRuns(db)
  if (runningError) summary.errors.push(`listRunningRuns: ${runningError}`)

  const { requeue, fail } = selectStaleRuns(running, now)

  for (const { row, error } of fail) {
    const { error: updateError } = await updateDriverRun(db, row.id, {
      status: 'error',
      error,
      lease_expires_at: null,
      completed_at: now.toISOString(),
    })
    if (updateError) summary.errors.push(`fail ${row.driver_key}: ${updateError}`)
    else summary.failed += 1
  }

  for (const row of requeue) {
    const { error: updateError } = await updateDriverRun(db, row.id, {
      status: 'queued',
      lease_expires_at: null,
      dispatched_at: null,
    })
    if (updateError) summary.errors.push(`requeue ${row.driver_key}: ${updateError}`)
    else summary.requeued += 1
  }

  // Re-dispatch: what we just requeued, plus anything that was queued long
  // enough that the original fan-out clearly never arrived.
  const { rows: queued, error: queuedError } = await listUndispatchedRuns(db)
  if (queuedError) summary.errors.push(`listUndispatchedRuns: ${queuedError}`)

  const toDispatch = new Map<string, { analysisId: string; driverKey: string }>()
  for (const row of [...requeue, ...selectUndispatchedRuns(queued, now)]) {
    toDispatch.set(row.id, { analysisId: row.analysis_id, driverKey: row.driver_key })
  }

  for (const job of toDispatch.values()) {
    const result = await dispatchDriverJob(baseUrl, job.analysisId, job.driverKey)
    if (result.dispatched) {
      summary.redispatched += 1
      await markDispatched(db, job.analysisId, [job.driverKey])
    } else {
      summary.errors.push(`dispatch ${job.driverKey}: ${result.error ?? 'unknown'}`)
    }
  }

  return summary
}

/** Progress of one analysis, for the poll route. */
export async function getAnalysisProgress(db: SupabaseClient, analysisId: string) {
  const { rows, error } = await listDriverRuns(db, analysisId)
  return { rows, progress: summarizeProgress(rows), error }
}
