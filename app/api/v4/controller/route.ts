export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeDomain } from '@/lib/v4/runner/store'
import {
  countFindings,
  runControllerChecks,
  type ControllerRun,
  type ControllerSite,
  type ControllerTemplate,
} from '@/lib/v4/controller/checks'

/**
 * GET /api/v4/controller?scope=all — the "check EVERY audit" sweep.
 *
 * Admin only (profiles.role = 'admin', the same gate the /api/admin routes
 * use): the sweep crosses ownership boundaries, so it runs on the service
 * client AFTER the role check — a non-admin gets 403, never partial data.
 *
 * Response is counts-only per analysis: the detail findings are recomputed
 * per-audit by /api/v4/analyses/[id]/controller when someone opens them.
 * Nothing is persisted — same on-demand philosophy as the per-audit route.
 *
 * Batching: analyses in chunks, three .in() reads per chunk (driver_runs,
 * template_configs, edits) — never one query per audit.
 */

const CONTROLLER_RUN_COLUMNS =
  'analysis_id, driver_key, enabled, status, score_absolute, score_relative, raw_payload, ' +
  'llm_insight, decision_request, error, attempts, max_attempts, ' +
  'created_at, dispatched_at, started_at, lease_expires_at'

const CHUNK_SIZE = 25

interface AnalysisRow {
  id: string
  domain: string | null
  brand_name: string | null
  competitors: string[] | null
  competitor_details: Array<{ url?: string; domain?: string; brand_name?: string }> | null
  ref_date: string | null
  v4_insights_status: string | null
  v4_insights_error: string | null
  created_at: string | null
}

/** Same set-building rules as loadAnalysisSites, but on an already-read row
 *  (the sweep cannot afford one analyses .single() per audit). */
function sitesOf(a: AnalysisRow): ControllerSite[] {
  const sites: ControllerSite[] = []
  if (a.domain) {
    const d = normalizeDomain(a.domain)
    sites.push({ site_ref: 'client', domain: d, name: a.brand_name || d, is_client: true })
  }
  const details = Array.isArray(a.competitor_details) ? a.competitor_details : []
  const legacy = Array.isArray(a.competitors) ? a.competitors : []
  const competitors = details.length > 0
    ? details.map((c) => ({ domain: normalizeDomain(c.domain ?? c.url ?? ''), name: c.brand_name ?? null }))
    : legacy.map((url) => ({ domain: normalizeDomain(url), name: null }))
  competitors
    .filter((c) => c.domain)
    .slice(0, 4)
    .forEach((c, i) => {
      sites.push({
        site_ref: `competitor_${i + 1}`,
        domain: c.domain,
        name: c.name || c.domain,
        is_client: false,
      })
    })
  return sites
}

export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get('scope')
  if (scope !== 'all') {
    return NextResponse.json({ error: 'unsupported scope: use ?scope=all' }, { status: 400 })
  }

  // --- admin gate (same shape as app/api/admin/*) --------------------------
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const db = createAdminClient()
  const now = new Date()

  // Every V4 audit: ref_date set is THE V4 discriminator (lib/v4/audits).
  const { data: analysesData, error: analysesError } = await db
    .from('analyses')
    .select(
      'id, domain, brand_name, competitors, competitor_details, ref_date, ' +
        'v4_insights_status, v4_insights_error, created_at',
    )
    .not('ref_date', 'is', null)
    .order('created_at', { ascending: false })
  if (analysesError) {
    return NextResponse.json({ error: analysesError.message }, { status: 500 })
  }

  const analyses = (analysesData ?? []) as unknown as AnalysisRow[]
  const results: Array<{
    analysis_id: string
    domain: string | null
    counts: { error: number; warning: number; info: number }
  }> = []

  for (let i = 0; i < analyses.length; i += CHUNK_SIZE) {
    const chunk = analyses.slice(i, i + CHUNK_SIZE)
    const ids = chunk.map((a) => a.id)

    const [runsRes, templatesRes, draftsRes] = await Promise.all([
      db.from('driver_runs').select(CONTROLLER_RUN_COLUMNS).in('analysis_id', ids),
      db.from('template_configs').select('analysis_id, site_ref, template_key, url').in('analysis_id', ids),
      db.from('edits').select('analysis_id, created_at').eq('published', false).in('analysis_id', ids),
    ])
    const chunkError =
      runsRes.error?.message ?? templatesRes.error?.message ?? draftsRes.error?.message ?? null
    if (chunkError) {
      return NextResponse.json({ error: chunkError }, { status: 500 })
    }

    const runsBy = groupBy(
      (runsRes.data ?? []) as unknown as Array<ControllerRun & { analysis_id: string }>,
    )
    const templatesBy = groupBy(
      (templatesRes.data ?? []) as unknown as Array<ControllerTemplate & { analysis_id: string }>,
    )
    const draftsBy = groupBy(
      (draftsRes.data ?? []) as unknown as Array<{ analysis_id: string; created_at: string }>,
    )

    for (const a of chunk) {
      const drafts = (draftsBy.get(a.id) ?? []).sort((x, y) =>
        x.created_at.localeCompare(y.created_at),
      )
      const findings = runControllerChecks({
        analysis: {
          id: a.id,
          domain: a.domain,
          ref_date: a.ref_date,
          v4_insights_status: a.v4_insights_status,
          v4_insights_error: a.v4_insights_error,
          created_at: a.created_at,
        },
        sites: sitesOf(a),
        runs: runsBy.get(a.id) ?? [],
        templates: templatesBy.get(a.id) ?? [],
        edits: { draftCount: drafts.length, oldestDraftAt: drafts[0]?.created_at ?? null },
        now,
      })
      results.push({ analysis_id: a.id, domain: a.domain, counts: countFindings(findings) })
    }
  }

  return NextResponse.json(results)
}

function groupBy<T extends { analysis_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const list = map.get(row.analysis_id) ?? []
    list.push(row)
    map.set(row.analysis_id, list)
  }
  return map
}
