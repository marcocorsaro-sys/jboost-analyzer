/**
 * V4 runner — run planning (pure).
 *
 * Turns "the analyst enabled these drivers on this set of sites" into the
 * exact list of driver_runs rows to seed, applying the gating rules of the
 * spec before a single API unit is spent:
 *
 *  - Business drivers REQUIRE >=1 competitor (README 01 §3). Enabling one
 *    with a competitor-less set is a setup error, not a runtime failure.
 *  - Development drivers can run alone (Absolute view only).
 *  - Unknown / out-of-scope keys (aso_visibility) are rejected, not ignored.
 */

import { V4_DRIVERS, getV4Driver, type V4DriverKey } from '@/lib/scoring/registry'
import type { AnalysisSite } from './types'

export interface PlannedRun {
  driver_key: V4DriverKey
  enabled: true
  config: Record<string, unknown>
  status: 'queued'
}

export interface PlanResult {
  runs: PlannedRun[]
  /** Blocking setup errors: the analysis must not start. */
  errors: string[]
}

export interface PlanInput {
  /** Driver keys the analyst enabled in the setup wizard. */
  enabledDrivers: string[]
  sites: AnalysisSite[]
  /** Optional per-driver config from the wizard (driver_runs.config). */
  driverConfig?: Record<string, Record<string, unknown>>
}

export function planDriverRuns(input: PlanInput): PlanResult {
  const errors: string[] = []
  const runs: PlannedRun[] = []

  const clients = input.sites.filter((s) => s.is_client)
  const competitorCount = input.sites.filter((s) => !s.is_client).length

  if (clients.length !== 1) {
    errors.push(`the set must contain exactly one client site (got ${clients.length})`)
  }
  if (competitorCount > 4) {
    errors.push(`at most 4 competitors are supported (got ${competitorCount})`)
  }

  const seen = new Set<string>()
  for (const key of input.enabledDrivers) {
    if (seen.has(key)) continue
    seen.add(key)

    const def = getV4Driver(key)
    if (!def) {
      errors.push(`unknown driver "${key}" (not in the V4 catalog of 10)`)
      continue
    }
    if (def.competitorMandatory && competitorCount < 1) {
      errors.push(
        `driver "${key}" is a Business driver and requires at least 1 competitor`,
      )
      continue
    }
    runs.push({
      driver_key: def.key as V4DriverKey,
      enabled: true,
      config: input.driverConfig?.[key] ?? {},
      status: 'queued',
    })
  }

  if (runs.length === 0 && errors.length === 0) {
    errors.push('no drivers enabled')
  }

  // Seed in UI order so the results tabs fill left-to-right as jobs land.
  const uiOrder = new Map(V4_DRIVERS.map((d) => [d.key, d.uiOrder]))
  runs.sort((a, b) => (uiOrder.get(a.driver_key) ?? 99) - (uiOrder.get(b.driver_key) ?? 99))

  return { runs, errors }
}

/**
 * REF_DATE (sheet 8b): last day of the last COMPLETE month, frozen at launch
 * so every date-accepting endpoint in the run uses the same one. Returned as
 * an ISO date string (YYYY-MM-DD).
 */
export function computeRefDate(now: Date): string {
  // Day 0 of the current month = last day of the previous month, in UTC.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  return d.toISOString().slice(0, 10)
}
