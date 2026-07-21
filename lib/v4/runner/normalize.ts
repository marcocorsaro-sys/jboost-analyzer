/**
 * V4 runner — leader-index finalization (pure).
 *
 * Normalization is NOT a per-driver concern: a leader-index score only exists
 * relative to the set, so it is computed once all raws for a driver are in and
 * recomputed on the fly after every edit + Save & Publish (reuse map §6).
 *
 * This module is the bridge between the job table (driver_runs, one row per
 * driver, per-site raws stashed in raw_payload.sites) and the Block 1 scoring
 * core (lib/scoring/leader-index), which knows nothing about the DB.
 */

import { scoreSet, type ScoringSiteInput } from '@/lib/scoring/leader-index'
import { V4_LOG_DRIVERS, getV4Driver } from '@/lib/scoring/registry'
import type { DriverRunRow, SiteRawValue, SiteRef } from './types'

export interface NormalizedSite extends SiteRawValue {
  score_relative: number | null
  rank: number | null
}

export interface DriverRunUpdate {
  id: string
  driver_key: string
  /** The CLIENT's raw — the headline number of the driver card. */
  raw_value: number | null
  /** The CLIENT's leader-index score. */
  score_relative: number | null
  /** The CLIENT's intrinsic score, only for drivers with an Absolute view. */
  score_absolute: number | null
  /** raw_payload with per-site scores + leader metadata merged in. */
  raw_payload: Record<string, unknown>
}

/** Read the per-site raws a worker stashed in raw_payload. */
export function readSites(row: DriverRunRow): SiteRawValue[] {
  const sites = (row.raw_payload as { sites?: unknown })?.sites
  return Array.isArray(sites) ? (sites as SiteRawValue[]) : []
}

/**
 * Normalize every completed driver of one analysis.
 *
 * Only rows with status 'done' participate: a driver still queued, errored or
 * paused on needs_decision contributes null everywhere, and null is EXCLUDED
 * from the aggregate rather than counted as 0 (sheet 8).
 *
 * `edited` rows keep the analyst's score_relative untouched — the whole point
 * of "tutto editabile" is that a recompute must not silently overwrite a
 * human decision — but their raws still feed everyone else's normalization.
 */
export function normalizeAnalysis(rows: DriverRunRow[]): DriverRunUpdate[] {
  const done = rows.filter((r) => r.enabled && r.status === 'done')
  if (done.length === 0) return []

  // --- build the site set (union across drivers, client first) ------------
  const siteIndex = new Map<SiteRef, { domain: string; is_client: boolean }>()
  for (const row of done) {
    for (const s of readSites(row)) {
      if (!siteIndex.has(s.site_ref)) {
        siteIndex.set(s.site_ref, {
          domain: s.domain,
          is_client: s.site_ref === 'client',
        })
      }
    }
  }
  if (siteIndex.size === 0) return []

  const siteRefs = [...siteIndex.keys()].sort((a, b) =>
    a === 'client' ? -1 : b === 'client' ? 1 : a.localeCompare(b),
  )

  // --- assemble the scoring input ----------------------------------------
  const rawByRefAndDriver = new Map<string, number | null>()
  for (const row of done) {
    for (const s of readSites(row)) {
      rawByRefAndDriver.set(`${s.site_ref}::${row.driver_key}`, s.raw ?? null)
    }
  }

  const drivers = done.map((r) => r.driver_key)
  const scoringSites: ScoringSiteInput[] = siteRefs.map((ref) => {
    const meta = siteIndex.get(ref)!
    const raw: Record<string, number | null> = {}
    for (const driver of drivers) {
      raw[driver] = rawByRefAndDriver.get(`${ref}::${driver}`) ?? null
    }
    return { name: ref, domain: meta.domain, is_client: meta.is_client, raw }
  })

  const out = scoreSet({
    drivers,
    log_drivers: V4_LOG_DRIVERS.filter((k) => drivers.includes(k)),
    sites: scoringSites,
  })

  // --- fold the results back onto each driver_runs row --------------------
  const byRef = new Map(out.sites.map((s) => [s.name as SiteRef, s]))

  return done.map((row) => {
    const driver = row.driver_key
    const def = getV4Driver(driver)

    const sites: NormalizedSite[] = readSites(row).map((s) => {
      const scored = byRef.get(s.site_ref)
      return {
        ...s,
        score_relative: scored?.scores[driver] ?? null,
        rank: scored?.rank[driver] ?? null,
      }
    })

    const clientSite = sites.find((s) => s.site_ref === 'client')
    const clientScored = byRef.get('client')

    return {
      id: row.id,
      driver_key: driver,
      raw_value: clientSite?.raw ?? null,
      // Never overwrite a hand-edited score.
      score_relative: row.edited
        ? row.score_relative
        : (clientScored?.scores[driver] ?? null),
      score_absolute: def?.hasAbsoluteView
        ? (row.edited ? row.score_absolute : (clientSite?.score_absolute ?? null))
        : null,
      raw_payload: {
        ...row.raw_payload,
        sites,
        leader: out.leaders[driver] ?? null,
        normalized_at: null as string | null, // stamped by the caller
      },
    }
  })
}

/**
 * Overall progress of an analysis, for the results header and the poll route.
 * An analysis is complete when no enabled driver is still queued or running.
 */
export function summarizeProgress(rows: DriverRunRow[]): {
  total: number
  done: number
  error: number
  needs_decision: number
  pending: number
  complete: boolean
} {
  const enabled = rows.filter((r) => r.enabled)
  const count = (s: string) => enabled.filter((r) => r.status === s).length
  const pending = count('queued') + count('running')
  return {
    total: enabled.length,
    done: count('done'),
    error: count('error'),
    needs_decision: count('needs_decision'),
    pending,
    complete: enabled.length > 0 && pending === 0,
  }
}
