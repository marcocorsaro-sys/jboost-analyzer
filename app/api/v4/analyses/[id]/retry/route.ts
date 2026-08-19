export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { selectRetryDrivers, selectSingleRetry, type RetryRunSlice } from '@/lib/v4/retry'
import { dispatchAll, resolveBaseUrl } from '@/lib/v4/runner/dispatch'
import { markDispatched } from '@/lib/v4/runner/store'

/**
 * POST /api/v4/analyses/[id]/retry — relaunch drivers of an existing analysis
 * WITHOUT recreating it. Two modes:
 *
 *  - no body (or no `driver`): the blanket retry. Selection lives in
 *    lib/v4/retry.ts: only 'error' and 'queued' rows are touched. The reset
 *    restores a fresh attempt budget (the analyst explicitly asked for
 *    another try — usually after fixing a missing API key), clears the stale
 *    error, and re-dispatches the fan-out. Everything the analyst already
 *    produced survives: done scores, edits, decisions taken, paused questions.
 *
 *  - body {driver, force?}: relaunch that ONE driver. A 'done' row demands
 *    force:true and is re-measured as of today: raw/score/llm_insight are
 *    cleared, decision_taken and the comments are preserved, and edited rows
 *    keep their score_* so the normalize.ts edited-protection keeps holding.
 *    needs_decision is never relaunchable (409): it waits for the analyst.
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

  // Optional body: {driver, force?} switches to the single-driver relaunch.
  let body: { driver?: unknown; force?: unknown } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    /* no body = blanket retry, the original contract */
  }
  const singleDriver = typeof body.driver === 'string' && body.driver.trim() !== '' ? body.driver.trim() : null
  const force = body.force === true

  const db = createAdminClient()

  const { data: runData, error: runsError } = await db
    .from('driver_runs')
    .select('driver_key, enabled, status, edited')
    .eq('analysis_id', analysisId)
  if (runsError) {
    return NextResponse.json({ error: runsError.message }, { status: 500 })
  }
  const slices = (runData ?? []) as RetryRunSlice[]

  // ------------------------------------------------------ single driver ----
  if (singleDriver) {
    const decision = selectSingleRetry(slices, singleDriver, force)
    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.message, reason: decision.reason },
        { status: decision.httpStatus },
      )
    }

    const update: Record<string, unknown> = {
      status: 'queued',
      attempts: 0,
      error: null,
      lease_expires_at: null,
      dispatched_at: null,
    }
    if (decision.remeasure) {
      // Re-measure as of today: the old measurement and its derived artifacts
      // go; decision_taken and the analyst's comments stay (lib/v4/retry.ts).
      Object.assign(update, {
        raw_value: null,
        raw_payload: {},
        llm_insight: null,
        tier_used: null,
        started_at: null,
        completed_at: null,
      })
      if (!decision.preserveEditedScores) {
        Object.assign(update, { score_absolute: null, score_relative: null })
      }
    }

    const { error: resetError } = await db
      .from('driver_runs')
      .update(update)
      .eq('analysis_id', analysisId)
      .eq('driver_key', singleDriver)
    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 })
    }

    const dispatched = await dispatchAll(resolveBaseUrl(request), analysisId, [singleDriver])
    await markDispatched(
      db,
      analysisId,
      dispatched.filter((d) => d.dispatched).map((d) => d.driverKey),
    )
    const dispatchErrors = dispatched
      .filter((d) => !d.dispatched)
      .map((d) => `${d.driverKey}: ${d.error ?? 'dispatch failed'}`)

    return NextResponse.json(
      { retried: [singleDriver], skipped: [], remeasured: decision.remeasure, dispatchErrors },
      { status: dispatchErrors.length > 0 ? 207 : 200 },
    )
  }

  // ------------------------------------------------------ blanket retry ----
  const selection = selectRetryDrivers(slices)
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
