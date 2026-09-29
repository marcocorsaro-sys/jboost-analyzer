export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchInsightsJob } from '@/lib/v4/llm/dispatch'
import { resolveBaseUrl } from '@/lib/v4/runner/dispatch'
import { getV4Driver } from '@/lib/scoring/registry'
import type { LlmInsightRecord } from '@/lib/v4/llm/orchestrator'

/**
 * POST /api/v4/analyses/[id]/insights — kick off (or resume) the narrative
 * LLM orchestration of sheets 15/16: the sequential per-driver insight calls
 * plus the final Executive Summary.
 *
 * Preconditions, checked BEFORE a single token is spent:
 * - every enabled driver_run is in a terminal state (done / error): insights
 *   narrate a finished measurement, not a moving one;
 * - no open needs_decision: an unanswered pause means the analyst still owes
 *   the run a choice (409, with the drivers listed);
 * - at least one LLM-sequence driver is 'done': with nothing to narrate the
 *   run would only produce an empty summary.
 *
 * The work itself runs in the secret-authenticated /api/v4/insights/run
 * invocation chain (fire-and-continue, same pattern as the driver runner);
 * this route only flips v4_insights_status to 'running' and dispatches.
 * Re-POSTing is safe and is the retry path: stored insights are skipped
 * idempotently, errored ones are regenerated.
 *
 * TARGETED MODE (review item 3/13): an optional body { drivers: string[] }
 * generates/REgenerates the insight of ONLY those drivers. Each requested
 * driver must be enabled, 'done' and part of the LLM sequence; the state of
 * the OTHER drivers does not matter here (a queued or paused sibling never
 * blocks a targeted regeneration). Stored insights of the requested drivers
 * are cleared first, so the engine regenerates them; every other driver's
 * stored insight stays and keeps feeding the cumulative context. An absent
 * Executive Summary is NOT generated in targeted mode.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params

  // AuthN + AuthZ through RLS, exactly like the other V4 analysis routes.
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
    .select('id')
    .eq('id', analysisId)
    .maybeSingle()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  // Optional body: { drivers } switches to the targeted per-driver mode.
  let requestedDrivers: string[] | null = null
  try {
    const body = (await request.json()) as { drivers?: unknown }
    if (Array.isArray(body?.drivers)) {
      const list = body.drivers.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
      if (list.length > 0) requestedDrivers = [...new Set(list)]
    }
  } catch {
    /* no body = full orchestration, the original contract */
  }

  const db = createAdminClient()
  const { data: runData, error: runsError } = await db
    .from('driver_runs')
    .select('driver_key, enabled, status')
    .eq('analysis_id', analysisId)
  if (runsError) {
    return NextResponse.json({ error: runsError.message }, { status: 500 })
  }
  const runs = (runData ?? []) as Array<{ driver_key: string; enabled: boolean; status: string }>
  const enabled = runs.filter((r) => r.enabled)

  // ---------------------------------------------------- targeted mode -----
  if (requestedDrivers) {
    const problems: string[] = []
    for (const key of requestedDrivers) {
      const def = getV4Driver(key)
      const run = enabled.find((r) => r.driver_key === key)
      if (!def || !run) {
        problems.push(`${key}: driver sconosciuto o non abilitato per questa analisi`)
      } else if (def.llmSequence === null) {
        problems.push(`${key}: driver fuori dalla sequenza LLM (nessun insight generabile)`)
      } else if (run.status !== 'done') {
        problems.push(`${key}: stato "${run.status}", solo un driver completato può generare insight`)
      }
    }
    if (problems.length > 0) {
      return NextResponse.json(
        { error: `insight per driver non generabili: ${problems.join('; ')}` },
        { status: 409 },
      )
    }

    // Clear the stored insights of the requested drivers so the engine
    // regenerates them (it skips 'done' insights by design). The other
    // drivers' insights stay and keep feeding the cumulative context.
    const { error: clearError } = await db
      .from('driver_runs')
      .update({ llm_insight: null })
      .eq('analysis_id', analysisId)
      .in('driver_key', requestedDrivers)
    if (clearError) {
      return NextResponse.json({ error: clearError.message }, { status: 500 })
    }

    const { error: statusError } = await db
      .from('analyses')
      .update({ v4_insights_status: 'running', v4_insights_error: null })
      .eq('id', analysisId)
    if (statusError) {
      return NextResponse.json({ error: statusError.message }, { status: 500 })
    }

    const dispatch = await dispatchInsightsJob(resolveBaseUrl(request), analysisId, requestedDrivers)
    if (!dispatch.dispatched) {
      await db
        .from('analyses')
        .update({
          v4_insights_status: 'error',
          v4_insights_error: `dispatch insight fallito: ${dispatch.error ?? 'unknown'}`,
        })
        .eq('id', analysisId)
      return NextResponse.json(
        { error: `dispatch failed: ${dispatch.error ?? 'unknown'}` },
        { status: 502 },
      )
    }

    return NextResponse.json(
      { status: 'accepted', analysisId, drivers: requestedDrivers, targeted: true },
      { status: 202 },
    )
  }

  // ---------------------------------------------------- full orchestration -
  const pendingDecision = enabled.filter((r) => r.status === 'needs_decision')
  if (pendingDecision.length > 0) {
    return NextResponse.json(
      {
        error:
          'decisione aperta su ' +
          pendingDecision.map((r) => r.driver_key).join(', ') +
          ': risolvi il needs_decision prima di generare gli insight',
      },
      { status: 409 },
    )
  }

  const stillRunning = enabled.filter((r) => r.status === 'queued' || r.status === 'running')
  if (stillRunning.length > 0) {
    return NextResponse.json(
      {
        error:
          'driver ancora in esecuzione: ' +
          stillRunning.map((r) => r.driver_key).join(', '),
      },
      { status: 409 },
    )
  }

  const narratable = enabled.filter(
    (r) => r.status === 'done' && getV4Driver(r.driver_key)?.llmSequence !== null,
  )
  if (narratable.length === 0) {
    return NextResponse.json(
      { error: 'nessun driver della sequenza LLM completato: niente da narrare' },
      { status: 409 },
    )
  }

  // A stored Executive Summary is never regenerated by the engine
  // (idempotence) — but a DEGRADED one (Sprint 1 item 2c, raw text saved
  // when the JSON never parsed) exists precisely to be regenerated: clear
  // it here so this explicit full run produces a structured one.
  const { data: summaryRow } = await db
    .from('analyses')
    .select('v4_executive_summary')
    .eq('id', analysisId)
    .maybeSingle()
  const storedSummary = (summaryRow as { v4_executive_summary?: { json_degraded?: boolean } | null } | null)
    ?.v4_executive_summary
  const summaryReset = storedSummary?.json_degraded === true ? { v4_executive_summary: null } : {}

  const { error: statusError } = await db
    .from('analyses')
    .update({ v4_insights_status: 'running', v4_insights_error: null, ...summaryReset })
    .eq('id', analysisId)
  if (statusError) {
    return NextResponse.json({ error: statusError.message }, { status: 500 })
  }

  const dispatch = await dispatchInsightsJob(resolveBaseUrl(request), analysisId)
  if (!dispatch.dispatched) {
    // No invocation will ever pick this up: say so, do not fake 'running'.
    await db
      .from('analyses')
      .update({
        v4_insights_status: 'error',
        v4_insights_error: `dispatch insight fallito: ${dispatch.error ?? 'unknown'}`,
      })
      .eq('id', analysisId)
    return NextResponse.json(
      { error: `dispatch failed: ${dispatch.error ?? 'unknown'}` },
      { status: 502 },
    )
  }

  return NextResponse.json(
    { status: 'accepted', analysisId, drivers: narratable.map((r) => r.driver_key) },
    { status: 202 },
  )
}

/**
 * GET /api/v4/analyses/[id]/insights — poll endpoint: orchestration status,
 * per-driver insights (including per-driver failures — never hidden) and the
 * Executive Summary when present. Read through the user-scoped client so
 * RLS decides access.
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
    .select('id, v4_insights_status, v4_insights_error, v4_executive_summary')
    .eq('id', analysisId)
    .maybeSingle()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  const { data: runData, error: runsError } = await supabase
    .from('driver_runs')
    .select('driver_key, enabled, status, llm_insight')
    .eq('analysis_id', analysisId)
  if (runsError) {
    return NextResponse.json({ error: runsError.message }, { status: 500 })
  }

  const a = analysis as {
    v4_insights_status: string | null
    v4_insights_error: string | null
    v4_executive_summary: Record<string, unknown> | null
  }

  return NextResponse.json({
    analysisId,
    insightsStatus: a.v4_insights_status,
    insightsError: a.v4_insights_error,
    executiveSummary: a.v4_executive_summary,
    drivers: ((runData ?? []) as Array<{
      driver_key: string
      enabled: boolean
      status: string
      llm_insight: LlmInsightRecord | null
    }>)
      .filter((r) => r.enabled)
      .map((r) => ({
        driver_key: r.driver_key,
        status: r.status,
        llm_sequence: getV4Driver(r.driver_key)?.llmSequence ?? null,
        insight: r.llm_insight,
      })),
  })
}
