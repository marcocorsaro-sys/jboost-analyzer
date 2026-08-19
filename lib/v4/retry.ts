/**
 * V4 — "Rilancia analisi": which drivers a retry may touch.
 *
 * A retry exists for jobs that DIED (status 'error', attempts exhausted) or
 * got STUCK in the queue (dispatch failed, secret missing, protection wall —
 * every failure mode the first live run actually hit). It must never touch:
 *  - 'done' rows: a finished measurement is re-run through Save & Publish
 *    (the edited-drivers batch), not through a blanket retry;
 *  - 'needs_decision' rows: the job is waiting for the ANALYST, not for
 *    infrastructure — retrying it would just re-pause;
 *  - 'running' rows: a live lease belongs to a worker; the reaper (not the
 *    user) is the judge of whether it is dead.
 *
 * Pure and shared with tests; the route applies the reset + redispatch.
 */

export interface RetryRunSlice {
  driver_key: string
  enabled: boolean
  status: string
  /** True when the analyst hand-edited the score/comment (Block 6). */
  edited?: boolean
}

export interface RetrySelection {
  retry: string[]
  skipped: Array<{ driver_key: string; reason: 'done' | 'needs_decision' | 'running' | 'disabled' }>
}

export function selectRetryDrivers(runs: RetryRunSlice[]): RetrySelection {
  const retry: string[] = []
  const skipped: RetrySelection['skipped'] = []

  for (const run of runs) {
    if (!run.enabled) {
      skipped.push({ driver_key: run.driver_key, reason: 'disabled' })
      continue
    }
    if (run.status === 'error' || run.status === 'queued') {
      retry.push(run.driver_key)
      continue
    }
    if (run.status === 'done' || run.status === 'needs_decision' || run.status === 'running') {
      skipped.push({ driver_key: run.driver_key, reason: run.status })
    }
  }

  return { retry, skipped }
}

// ---------------------------------------------------------------------------
// Single-driver relaunch ("Rilancia questo driver")
// ---------------------------------------------------------------------------

/**
 * The single-driver retry is more permissive than the blanket one on exactly
 * ONE axis: a 'done' row may be re-measured, but only with an explicit
 * force=true — re-measuring is destructive (today's data replaces the
 * measurement) and must never happen because someone fat-fingered a retry.
 *
 * What a forced re-measure clears vs. preserves:
 *  - cleared: raw_value, raw_payload, llm_insight, tier_used — the
 *    MEASUREMENT and its derived artifacts, which the new run replaces;
 *  - preserved: decision_taken (the tier chosen, the J-Horizon paste — the
 *    analyst's answers survive, the worker reads them back via ctx),
 *    comment_absolute/relative (judgements, not measurements);
 *  - edited rows additionally KEEP score_absolute/score_relative: normalize.ts
 *    protects `edited` rows by re-writing row.score_*, so blanking them would
 *    launder the analyst's edit into a null. Keeping them is what makes the
 *    "gli edit restano" promise true end-to-end.
 *
 * needs_decision is NOT relaunchable, force or not: the job is waiting for
 * the ANALYST, and a relaunch would only re-ask the same question. 'running'
 * belongs to a live worker (the reaper judges dead leases, not the user).
 */
export type SingleRetryRefusal =
  | 'not_found'
  | 'disabled'
  | 'running'
  | 'needs_decision'
  | 'done_needs_force'

export type SingleRetryDecision =
  | {
      ok: true
      driver_key: string
      /** True when a 'done' row is being force re-measured (wipe + requeue). */
      remeasure: boolean
      /** True when the row is edited: score_* survive the wipe (see above). */
      preserveEditedScores: boolean
    }
  | { ok: false; reason: SingleRetryRefusal; httpStatus: 404 | 409; message: string }

export function selectSingleRetry(
  runs: RetryRunSlice[],
  driverKey: string,
  force = false,
): SingleRetryDecision {
  const run = runs.find((r) => r.driver_key === driverKey)
  if (!run) {
    return {
      ok: false,
      reason: 'not_found',
      httpStatus: 404,
      message: `driver sconosciuto per questa analisi: ${driverKey}`,
    }
  }
  if (!run.enabled) {
    return {
      ok: false,
      reason: 'disabled',
      httpStatus: 409,
      message: `il driver ${driverKey} è disabilitato in questa analisi: abilitalo dal setup prima di rilanciarlo`,
    }
  }
  if (run.status === 'running') {
    return {
      ok: false,
      reason: 'running',
      httpStatus: 409,
      message: `il driver ${driverKey} è in esecuzione: attendi che finisca (o che il reaper lo recuperi) prima di rilanciarlo`,
    }
  }
  if (run.status === 'needs_decision') {
    return {
      ok: false,
      reason: 'needs_decision',
      httpStatus: 409,
      message: `il driver ${driverKey} aspetta una decisione dell'analista: rispondi alla domanda nella sua tab, il rilancio non può decidere al posto tuo`,
    }
  }
  if (run.status === 'done' && !force) {
    return {
      ok: false,
      reason: 'done_needs_force',
      httpStatus: 409,
      message: `il driver ${driverKey} è completato: rimisurarlo azzera i dati misurati (gli edit e le decisioni restano). Conferma con force:true`,
    }
  }

  return {
    ok: true,
    driver_key: driverKey,
    remeasure: run.status === 'done',
    preserveEditedScores: run.status === 'done' && run.edited === true,
  }
}
