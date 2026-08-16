export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { selectRetryDrivers, type RetryRunSlice } from '@/lib/v4/retry'
import { dispatchAll, resolveBaseUrl } from '@/lib/v4/runner/dispatch'
import { markDispatched } from '@/lib/v4/runner/store'

/**
 * POST /api/v4/analyses/[id]/retry — relaunch the failed/stuck drivers of an
 * existing analysis WITHOUT recreating it.
 *
 * Selection lives in lib/v4/retry.ts: only 'error' and 'queued' rows are
 * touched. The reset restores a fresh attempt budget (the analyst explicitly
 * asked for another try — usually after fixing a missing API key), clears the
 * stale error, and re-dispatches the fan-out. Everything the analyst already
 * produced survives: done scores, edits, decisions taken, paused questions.
 *
 * /start cannot do this: its seed upserts with ignoreDuplicates, so a row
 * that converged to 'error' stays dead forever unless someone resets it.
 */
export async function POST(
  request: Request,
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

  // RLS decides visibility, exactly like the sibling routes.
  const { data: analysis, error: fetchError } = await supabase
    .from('analyses')
    .select('id')
    .eq('id', analysisId)
    .maybeSingle()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  const db = createAdminClient()

  const { data: runData, error: runsError } = await db
    .from('driver_runs')
    .select('driver_key, enabled, status')
    .eq('analysis_id', analysisId)
  if (runsError) {
    return NextResponse.json({ error: runsError.message }, { status: 500 })
  }

  const selection = selectRetryDrivers((runData ?? []) as RetryRunSlice[])
  if (selection.retry.length === 0) {
    return NextResponse.json({
      retried: [],
      skipped: selection.skipped,
      message: 'nessun driver da rilanciare: nessuno è in errore o fermo in coda',
    })
  }

  // Reset: fresh attempts, no stale error, no lease, undispatched — the
  // analyst's data (edited flags, decisions, done siblings) is untouched.
  const { error: resetError } = await db
    .from('driver_runs')
    .update({
      status: 'queued',
      attempts: 0,
      error: null,
      lease_expires_at: null,
      dispatched_at: null,
    })
    .eq('analysis_id', analysisId)
    .in('driver_key', selection.retry)
  if (resetError) {
    return NextResponse.json({ error: resetError.message }, { status: 500 })
  }

  const dispatched = await dispatchAll(resolveBaseUrl(request), analysisId, selection.retry)
  await markDispatched(
    db,
    analysisId,
    dispatched.filter((d) => d.dispatched).map((d) => d.driverKey),
  )

  const dispatchErrors = dispatched
    .filter((d) => !d.dispatched)
    .map((d) => `${d.driverKey}: ${d.error ?? 'dispatch failed'}`)

  return NextResponse.json(
    {
      retried: selection.retry,
      skipped: selection.skipped,
      dispatchErrors,
    },
    // Partial dispatch failure is loud, never silent — same contract as publish.
    { status: dispatchErrors.length > 0 ? 207 : 200 },
  )
}
