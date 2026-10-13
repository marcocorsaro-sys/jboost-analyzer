/**
 * V4 runner — reaper (pure).
 *
 * A driver job runs inside its own Vercel invocation. If that invocation dies
 * (OOM, deploy, platform hiccup) the row stays 'running' forever with nobody
 * working on it. There is no heartbeat, so the only honest signal is the
 * lease: a worker takes one on claim, and an expired lease means the worker
 * is gone.
 *
 * The cron that already exists (app/api/cron/refresh-clients) is the reaper
 * host per reuse map §6 — no new infrastructure.
 */

import type { DriverRunRow } from './types'

export interface ReapDecision {
  /** Lease expired, attempts left: put it back in the queue. */
  requeue: DriverRunRow[]
  /** Lease expired and out of attempts: give up, surface the failure. */
  fail: Array<{ row: DriverRunRow; error: string }>
}

export interface ReapOptions {
  /** Grace period past lease expiry before acting, to absorb clock skew. */
  graceMs?: number
}

export function selectStaleRuns(
  rows: DriverRunRow[],
  now: Date,
  options: ReapOptions = {},
): ReapDecision {
  const graceMs = options.graceMs ?? 30_000
  const cutoff = now.getTime() - graceMs

  const requeue: DriverRunRow[] = []
  const fail: Array<{ row: DriverRunRow; error: string }> = []

  for (const row of rows) {
    if (row.status !== 'running') continue

    // A running row with no lease predates the runner or was written by hand.
    // Treat started_at as the lease anchor rather than leaving it stuck.
    const anchor = row.lease_expires_at ?? row.started_at
    if (!anchor) continue

    const expiresAt = new Date(anchor).getTime()
    if (!Number.isFinite(expiresAt) || expiresAt > cutoff) continue

    if (row.attempts >= row.max_attempts) {
      fail.push({
        row,
        error:
          `il worker si è interrotto senza completare la misura, tentativi esauriti ` +
          `(${row.attempts} su ${row.max_attempts}; lease scaduto alle ${new Date(expiresAt).toISOString()})`,
      })
    } else {
      requeue.push(row)
    }
  }

  return { requeue, fail }
}

/**
 * Queued jobs nobody is working on.
 *
 * Distinct from a stale lease. Two shapes land here (fix 13/10, the ariston
 * case):
 *  - never dispatched: the fan-out HTTP call failed and dispatched_at is
 *    NULL — the anchor is created_at;
 *  - dispatched but never claimed OR claimed, failed retryably and requeued:
 *    dispatched_at is set (possibly by the 04:00 cron) and the row sits
 *    'queued' with nobody coming back for it — the anchor is dispatched_at.
 * Either way, a 'queued' row whose anchor is older than the grace period has
 * no live worker (a real claim happens within seconds of a dispatch), so it
 * is safe to redispatch: the atomic claim makes a duplicate harmless.
 *
 * They are indistinguishable from a job queued one second ago, so the only
 * honest discriminator is age — hence the grace period, which must
 * comfortably exceed a cold start.
 */
export function selectUndispatchedRuns(
  rows: DriverRunRow[],
  now: Date,
  staleAfterMs = 5 * 60_000,
): DriverRunRow[] {
  const cutoff = now.getTime() - staleAfterMs

  return rows.filter((row) => {
    if (row.status !== 'queued' || !row.enabled) return false
    if (row.attempts >= row.max_attempts) return false

    const anchor = row.dispatched_at ?? row.created_at
    if (!anchor) return false

    const ts = new Date(anchor).getTime()
    return Number.isFinite(ts) && ts <= cutoff
  })
}
