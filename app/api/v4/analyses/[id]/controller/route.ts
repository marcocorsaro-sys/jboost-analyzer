export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadAnalysisSites, loadTemplateConfigs } from '@/lib/v4/runner/store'
import {
  countFindings,
  runControllerChecks,
  type ControllerEditsDigest,
  type ControllerRun,
} from '@/lib/v4/controller/checks'

/**
 * GET /api/v4/analyses/[id]/controller
 *
 * The Controller pass for ONE audit: the deterministic reviewer that checks
 * what no single worker can see (domains outside the current set, leader
 * invariant broken, stuck jobs...). Recomputed on demand and never persisted:
 * findings are derived state, and storing them would only let them go stale —
 * the DB stays clean, the "Ricontrolla" button is a plain re-GET.
 *
 * Auth: user-scoped client, RLS decides access — same model as the sibling
 * /status and /insights routes (the .single() on analyses is the gate).
 */

/** The driver_runs columns the checks engine needs (RUN_COLUMNS + llm_insight). */
const CONTROLLER_RUN_COLUMNS =
  'driver_key, enabled, status, score_absolute, score_relative, raw_payload, ' +
  'llm_insight, decision_request, error, attempts, max_attempts, ' +
  'created_at, dispatched_at, started_at, lease_expires_at'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: analysis, error: fetchError } = await supabase
    .from('analyses')
    .select('id, domain, ref_date, v4_insights_status, v4_insights_error, created_at')
    .eq('id', analysisId)
    .single()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  const [{ sites, error: sitesError }, { templates, error: templatesError }, runsRes, draftsRes] =
    await Promise.all([
      loadAnalysisSites(supabase, analysisId),
      loadTemplateConfigs(supabase, analysisId),
      supabase.from('driver_runs').select(CONTROLLER_RUN_COLUMNS).eq('analysis_id', analysisId),
      supabase
        .from('edits')
        .select('created_at')
        .eq('analysis_id', analysisId)
        .eq('published', false)
        .order('created_at', { ascending: true }),
    ])

  const firstError =
    sitesError ?? templatesError ?? runsRes.error?.message ?? draftsRes.error?.message ?? null
  if (firstError) {
    return NextResponse.json({ error: firstError }, { status: 500 })
  }

  const drafts = (draftsRes.data ?? []) as Array<{ created_at: string }>
  const edits: ControllerEditsDigest = {
    draftCount: drafts.length,
    oldestDraftAt: drafts[0]?.created_at ?? null,
  }

  const findings = runControllerChecks({
    analysis: analysis as {
      id: string
      domain: string | null
      ref_date: string | null
      v4_insights_status: string | null
      v4_insights_error: string | null
      created_at: string | null
    },
    sites,
    runs: (runsRes.data ?? []) as unknown as ControllerRun[],
    templates,
    edits,
    now: new Date(),
  })

  return NextResponse.json({
    findings,
    counts: countFindings(findings),
    checked_at: new Date().toISOString(),
  })
}
