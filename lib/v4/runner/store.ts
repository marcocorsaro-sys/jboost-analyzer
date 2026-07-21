/**
 * V4 runner — Supabase data access.
 *
 * Every function here takes an explicit service-role client: a driver job runs
 * with no user session, and keeping the handle a parameter (rather than a
 * module singleton) is what lets the runner logic be exercised in tests
 * against a fake.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnalysisSite, DriverRunRow, SiteRef, TemplateConfig } from './types'
import type { PlannedRun } from './planner'

const RUN_COLUMNS =
  'id, analysis_id, driver_key, enabled, config, status, raw_value, score_absolute, ' +
  'score_relative, tier_used, raw_payload, decision_request, decision_taken, error, ' +
  'edited, attempts, max_attempts, started_at, completed_at, lease_expires_at, ' +
  'dispatched_at, created_at'

export async function seedDriverRuns(
  db: SupabaseClient,
  analysisId: string,
  planned: PlannedRun[],
): Promise<{ error: string | null }> {
  if (planned.length === 0) return { error: null }
  const { error } = await db.from('driver_runs').upsert(
    planned.map((p) => ({
      analysis_id: analysisId,
      driver_key: p.driver_key,
      enabled: p.enabled,
      config: p.config,
      status: p.status,
    })),
    { onConflict: 'analysis_id,driver_key', ignoreDuplicates: true },
  )
  return { error: error?.message ?? null }
}

export async function listDriverRuns(
  db: SupabaseClient,
  analysisId: string,
): Promise<{ rows: DriverRunRow[]; error: string | null }> {
  const { data, error } = await db
    .from('driver_runs')
    .select(RUN_COLUMNS)
    .eq('analysis_id', analysisId)
  return { rows: (data ?? []) as unknown as DriverRunRow[], error: error?.message ?? null }
}

/**
 * Atomically take the job. Delegates to the Postgres function so two
 * concurrent dispatchers can never hand the same driver to two workers:
 * the loser gets zero rows back and simply does nothing.
 */
export async function claimDriverRun(
  db: SupabaseClient,
  analysisId: string,
  driverKey: string,
  leaseSecs: number,
): Promise<{ row: DriverRunRow | null; error: string | null }> {
  const { data, error } = await db.rpc('v4_claim_driver_run', {
    p_analysis_id: analysisId,
    p_driver_key: driverKey,
    p_lease_secs: leaseSecs,
  })
  if (error) return { row: null, error: error.message }
  const rows = (data ?? []) as unknown as DriverRunRow[]
  return { row: rows[0] ?? null, error: null }
}

export async function updateDriverRun(
  db: SupabaseClient,
  runId: string,
  patch: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await db.from('driver_runs').update(patch).eq('id', runId)
  return { error: error?.message ?? null }
}

/** All 'running' rows across all analyses — the reaper's input. */
export async function listRunningRuns(
  db: SupabaseClient,
  limit = 200,
): Promise<{ rows: DriverRunRow[]; error: string | null }> {
  const { data, error } = await db
    .from('driver_runs')
    .select(RUN_COLUMNS)
    .eq('status', 'running')
    .order('lease_expires_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  return { rows: (data ?? []) as unknown as DriverRunRow[], error: error?.message ?? null }
}

/**
 * Jobs that were seeded but never handed to a worker.
 *
 * The start route's fan-out is a best-effort HTTP call: if it fails (cold
 * start, network blip, deploy mid-flight) the row just sits at 'queued' with
 * dispatched_at NULL and nobody ever picks it up. This is the query that lets
 * the cron notice, and it is the reason dispatched_at exists at all.
 */
export async function listUndispatchedRuns(
  db: SupabaseClient,
  limit = 200,
): Promise<{ rows: DriverRunRow[]; error: string | null }> {
  const { data, error } = await db
    .from('driver_runs')
    .select(RUN_COLUMNS)
    .eq('status', 'queued')
    .eq('enabled', true)
    .order('created_at', { ascending: true })
    .limit(limit)
  return { rows: (data ?? []) as unknown as DriverRunRow[], error: error?.message ?? null }
}

/**
 * Page templates of one analysis. Empty until the Block 3 setup wizard lands;
 * every page-based driver must cope with that and say what it measured.
 */
export async function loadTemplateConfigs(
  db: SupabaseClient,
  analysisId: string,
): Promise<{ templates: TemplateConfig[]; error: string | null }> {
  const { data, error } = await db
    .from('template_configs')
    .select('site_ref, template_key, url, applies_to')
    .eq('analysis_id', analysisId)
  return {
    templates: (data ?? []) as unknown as TemplateConfig[],
    error: error?.message ?? null,
  }
}

/** Stamp the moment a dispatcher handed these jobs to the worker route. */
export async function markDispatched(
  db: SupabaseClient,
  analysisId: string,
  driverKeys: string[],
): Promise<{ error: string | null }> {
  if (driverKeys.length === 0) return { error: null }
  const { error } = await db
    .from('driver_runs')
    .update({ dispatched_at: new Date().toISOString() })
    .eq('analysis_id', analysisId)
    .in('driver_key', driverKeys)
  return { error: error?.message ?? null }
}

/**
 * The site set of one analysis, in the shape the workers expect.
 *
 * V4 setup writes structured competitors into analyses.competitor_details
 * (Block 1 migration); the V1 competitors TEXT[] column is the fallback for
 * analyses created before the wizard lands (Block 3).
 */
export async function loadAnalysisSites(
  db: SupabaseClient,
  analysisId: string,
): Promise<{
  sites: AnalysisSite[]
  refDate: string | null
  country: string | null
  error: string | null
}> {
  const { data, error } = await db
    .from('analyses')
    .select('id, domain, brand_name, brand_variants, competitors, competitor_details, ref_date, country')
    .eq('id', analysisId)
    .single()

  if (error || !data) {
    return { sites: [], refDate: null, country: null, error: error?.message ?? 'analysis not found' }
  }

  const a = data as {
    domain: string | null
    brand_name: string | null
    brand_variants: string[] | null
    competitors: string[] | null
    competitor_details: Array<{ url?: string; domain?: string; brand_name?: string; brand_variants?: string[] }> | null
    ref_date: string | null
    country: string | null
  }

  const sites: AnalysisSite[] = []
  if (a.domain) {
    sites.push({
      site_ref: 'client',
      domain: normalizeDomain(a.domain),
      name: a.brand_name || normalizeDomain(a.domain),
      is_client: true,
      brand_name: a.brand_name,
      brand_variants: a.brand_variants ?? [],
    })
  }

  const details = Array.isArray(a.competitor_details) ? a.competitor_details : []
  const legacy = Array.isArray(a.competitors) ? a.competitors : []
  const competitors = details.length > 0
    ? details.map((c) => ({
        domain: normalizeDomain(c.domain ?? c.url ?? ''),
        brand_name: c.brand_name ?? null,
        brand_variants: c.brand_variants ?? [],
      }))
    : legacy.map((url) => ({ domain: normalizeDomain(url), brand_name: null, brand_variants: [] }))

  competitors
    .filter((c) => c.domain)
    .slice(0, 4)
    .forEach((c, i) => {
      sites.push({
        site_ref: `competitor_${i + 1}` as SiteRef,
        domain: c.domain,
        name: c.brand_name || c.domain,
        is_client: false,
        brand_name: c.brand_name,
        brand_variants: c.brand_variants,
      })
    })

  return { sites, refDate: a.ref_date, country: a.country, error: null }
}

/** Bare domain: no protocol, no www., no path, lowercase (sheet 8b). */
export function normalizeDomain(input: string): string {
  if (!input) return ''
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
}
