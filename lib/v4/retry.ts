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
