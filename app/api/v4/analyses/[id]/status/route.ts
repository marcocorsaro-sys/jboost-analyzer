export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAnalysisProgress } from '@/lib/v4/runner/execute'
import { readSites } from '@/lib/v4/runner/normalize'

/**
 * GET /api/v4/analyses/[id]/status
 *
 * Poll endpoint for the results page: one row per driver with its state,
 * scores and — when it failed — the actual reason. No aggregate that hides a
 * failure behind a number: a driver in 'error' shows as 'error', never as 0.
 *
 * Read through the user-scoped client so RLS decides access, exactly like the
 * V1 routes; driver_runs carries the phase8 checkpoint RLS model.
 */
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
    .select('id, ref_date')
    .eq('id', analysisId)
    .single()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  const { rows, progress, error } = await getAnalysisProgress(supabase, analysisId)
  if (error) {
    return NextResponse.json({ error }, { status: 500 })
  }

  return NextResponse.json({
    analysisId,
    refDate: (analysis as { ref_date: string | null }).ref_date,
    progress,
    drivers: rows.map((r) => ({
      driver_key: r.driver_key,
      status: r.status,
      enabled: r.enabled,
      raw_value: r.raw_value,
      score_absolute: r.score_absolute,
      score_relative: r.score_relative,
      comment_absolute: r.comment_absolute,
      comment_relative: r.comment_relative,
      tier_used: r.tier_used,
      edited: r.edited,
      attempts: r.attempts,
      max_attempts: r.max_attempts,
      error: r.error,
      started_at: r.started_at,
      completed_at: r.completed_at,
      sites: readSites(r),
      decision_request:
        r.status === 'needs_decision'
          ? ((r.raw_payload as { decision_request?: unknown })?.decision_request ?? null)
          : null,
    })),
  })
}
