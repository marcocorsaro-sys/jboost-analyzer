/**
 * V4 — Save & Publish batch re-run selection (pure).
 *
 * The Bibbia delta this module implements (UX-UI sheet 3/6, both verbatim):
 * "Save & Publish re-runs in BATCH only the drivers with saved draft edits
 * (not one at a time)". Publishing stamps the drafts; the re-run refreshes
 * the MEASUREMENT of exactly the drivers the analyst touched, in one batch,
 * so nobody waits once per driver.
 *
 * Why the re-run does not erase the analyst's work: normalize.ts never
 * overwrites score/comment on a row flagged `edited` — the worker re-measures
 * the raws (and everyone else's leader index moves accordingly), while the
 * human judgement on the edited row stays exactly where the analyst put it.
 *
 * This module is pure so the SAME rule renders the client-side diff preview
 * ("these drivers will re-run, these edits stay") and drives the server-side
 * requeue — one source of truth, no drift between what the dialog promises
 * and what the publish route does.
 */

import { getV4Driver } from '@/lib/scoring/registry'

/** The driver_runs slice this selection needs. */
export interface RerunRunSlice {
  id: string
  driver_key: string
  enabled: boolean
  status: string
}

/** The edits slice this selection needs (draft rows of the analysis). */
export interface RerunEditSlice {
  driver_run_id: string | null
  field: string
  published: boolean
}

export interface RerunSelection {
  /** Driver keys to re-queue, unique, in Business-first UI order. */
  rerun: Array<{ id: string; driver_key: string }>
  /** Draft-edited runs that must NOT be re-queued, with the reason why. */
  ineligible: Array<{ driver_key: string; reason: string }>
}

/** Terminal states a re-run may start from. A queued/running job is already
 *  on its way; re-queuing it would only reset its attempts mid-flight. */
const RERUNNABLE_STATUSES: ReadonlySet<string> = new Set(['done', 'error'])

/**
 * Which drivers Save & Publish must re-run: exactly those whose run carries
 * at least one DRAFT edit. Published edits are history, not pending work —
 * they were already part of a previous publish batch.
 */
export function selectRerunDrivers(
  runs: RerunRunSlice[],
  edits: RerunEditSlice[],
): RerunSelection {
  const byId = new Map(runs.map((r) => [r.id, r]))

  const draftRunIds = new Set<string>()
  for (const e of edits) {
    if (!e.published && e.driver_run_id) draftRunIds.add(e.driver_run_id)
  }

  const rerun: RerunSelection['rerun'] = []
  const ineligible: RerunSelection['ineligible'] = []

  for (const runId of draftRunIds) {
    const run = byId.get(runId)
    // An edit pointing at a run this analysis does not have is stale data
    // (e.g. the run row was deleted); nothing to re-run, nothing to report.
    if (!run) continue

    if (!run.enabled) {
      ineligible.push({ driver_key: run.driver_key, reason: 'driver disabilitato' })
      continue
    }
    if (!RERUNNABLE_STATUSES.has(run.status)) {
      ineligible.push({
        driver_key: run.driver_key,
        reason: `stato "${run.status}": il job è già in corso o attende una decisione`,
      })
      continue
    }
    rerun.push({ id: run.id, driver_key: run.driver_key })
  }

  // Business-first UI order (registry uiOrder), same order the tabs use.
  const order = (key: string) => getV4Driver(key)?.uiOrder ?? 99
  rerun.sort((a, b) => order(a.driver_key) - order(b.driver_key))
  ineligible.sort((a, b) => order(a.driver_key) - order(b.driver_key))

  return { rerun, ineligible }
}
