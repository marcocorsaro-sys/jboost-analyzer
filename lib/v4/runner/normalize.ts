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

/** One unmeasured site, with the best reason the payload records. */
export interface UnmeasuredDetail {
  domain: string
  /** null = the run predates reason capture: the UI says "misura non riuscita". */
  reason: string | null
}

/**
 * Pure (Sprint 2 item 19): pair every domain the worker declared unmeasured
 * with the most specific reason its payload carries — Traffic's
 * coverage_alerts ({domain, reason}), Compliance's per-domain errors
 * ("domain: message"), or the first generic error mentioning the domain.
 * Nothing is invented: a domain with no recorded reason stays null.
 */
export function readUnmeasuredDetails(
  rawPayload: Record<string, unknown> | null | undefined,
): UnmeasuredDetail[] {
  const p = rawPayload ?? {}
  const unmeasured = Array.isArray(p.unmeasured)
    ? (p.unmeasured as unknown[]).filter((d): d is string => typeof d === 'string' && d !== '')
    : []
  if (unmeasured.length === 0) return []

  const alerts = Array.isArray(p.coverage_alerts)
    ? (p.coverage_alerts as Array<{ domain?: unknown; reason?: unknown }>)
    : []
  const errors = Array.isArray(p.errors)
    ? (p.errors as unknown[]).filter((e): e is string => typeof e === 'string')
    : []
  // Discoverability: a domain the analyst removed on a pause is not a
  // failure — say what happened instead of "misura non riuscita".
  const removedByAnalyst = new Set(
    Array.isArray(p.removed_by_analyst)
      ? (p.removed_by_analyst as unknown[]).filter((d): d is string => typeof d === 'string')
      : [],
  )

  const clip = (text: string): string => (text.length > 160 ? `${text.slice(0, 159)}…` : text)

  return unmeasured.map((domain) => {
    if (removedByAnalyst.has(domain)) {
      return { domain, reason: 'rimosso dal set su decisione dell\'analista' }
    }
    const alert = alerts.find((a) => a.domain === domain && typeof a.reason === 'string')
    if (alert) return { domain, reason: clip(String(alert.reason)) }
    const err = errors.find((e) => e.includes(domain))
    if (err) {
      // Compliance writes "domain: message" — keep only the message half.
      const stripped = err.startsWith(`${domain}: `) ? err.slice(domain.length + 2) : err
      return { domain, reason: clip(stripped) }
    }
    return { domain, reason: null }
  })
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
