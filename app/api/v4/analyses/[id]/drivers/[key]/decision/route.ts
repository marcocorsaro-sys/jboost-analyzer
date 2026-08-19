export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getV4Driver } from '@/lib/scoring/registry'
import { dispatchDriverJob, resolveBaseUrl } from '@/lib/v4/runner/dispatch'
import { markDispatched } from '@/lib/v4/runner/store'

const Body = z.object({
  /** Free-form per driver; the worker validates its own shape. */
  decision: z.record(z.unknown()),
})

/**
 * POST /api/v4/analyses/[id]/drivers/[key]/decision
 *
 * Answer a job paused on `needs_decision` — the Discoverability tier cascade
 * and the manual AI Visibility score both land here.
 *
 * The decision is stored on the row and the job is re-queued: the worker
 * re-runs with `ctx.decisionTaken` set and produces a real outcome. Nothing
 * is scored here; a route that wrote a score directly would bypass the
 * normalization and the audit trail.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; key: string }> },
) {
  const { id: analysisId, key: driverKey } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (!getV4Driver(driverKey)) {
    return NextResponse.json({ error: `unknown driver "${driverKey}"` }, { status: 400 })
  }

  // RLS decides access: if the row is not visible to this user, there is
  // nothing to answer.
  const { data: run, error: fetchError } = await supabase
    .from('driver_runs')
    .select('id, status, attempts, max_attempts')
    .eq('analysis_id', analysisId)
    .eq('driver_key', driverKey)
    .maybeSingle()
  if (fetchError || !run) {
    return NextResponse.json({ error: 'driver run not found or no access' }, { status: 404 })
  }

  let parsed: z.infer<typeof Body>
  try {
    parsed = Body.parse(await request.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  const db = createAdminClient()

  // --- Replace (Bibbia, Discoverability cascade): swap a competitor -------
  // "the audit re-runs from scratch with the decision ... The client domain
  // can never be Removed or Replaced." Changing the site set invalidates
  // EVERY driver's measurement (the leader index is a property of the set),
  // so this path rewrites the competitor, resets all runs and re-dispatches
  // the whole fan-out instead of requeueing one driver.
  const replace = parsed.decision.replace as
    | { from?: unknown; to?: unknown; brand_name?: unknown }
    | undefined
  if (driverKey === 'discoverability' && replace && typeof replace === 'object') {
    const from = String(replace.from ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
    const to = String(replace.to ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
    const brandName = typeof replace.brand_name === 'string' ? replace.brand_name.trim() : null
    if (!from || !to || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(to)) {
      return NextResponse.json({ error: 'replace richiede { from, to } con un dominio valido' }, { status: 400 })
    }

    const { data: analysis, error: aErr } = await db
      .from('analyses')
      .select('domain, competitors, competitor_details')
      .eq('id', analysisId)
      .single()
    if (aErr || !analysis) {
      return NextResponse.json({ error: aErr?.message ?? 'analysis not found' }, { status: 500 })
    }
    const a = analysis as {
      domain: string | null
      competitors: unknown
      competitor_details: unknown
    }
    if ((a.domain ?? '').toLowerCase().includes(from)) {
      return NextResponse.json(
        { error: 'il cliente non si può sostituire: solo Extend è disponibile per il cliente' },
        { status: 400 },
      )
    }
    const competitors = (Array.isArray(a.competitors) ? a.competitors : []) as string[]
    if (!competitors.includes(from)) {
      return NextResponse.json({ error: `"${from}" non è tra i competitor del set` }, { status: 400 })
    }
    const details = (Array.isArray(a.competitor_details) ? a.competitor_details : []) as Array<
      Record<string, unknown>
    >
    const newCompetitors = competitors.map((c) => (c === from ? to : c))
    const newDetails = details.map((d) =>
      d.domain === from
        ? { ...d, domain: to, ...(brandName ? { brand_name: brandName } : {}) }
        : d,
    )

    const { error: swapError } = await db
      .from('analyses')
      .update({ competitors: newCompetitors, competitor_details: newDetails })
      .eq('id', analysisId)
    if (swapError) {
      return NextResponse.json({ error: swapError.message }, { status: 500 })
    }

    // Full reset: every measurement referenced the old set.
    const { error: resetError } = await db
      .from('driver_runs')
      .update({
        status: 'queued',
        attempts: 0,
        error: null,
        lease_expires_at: null,
        dispatched_at: null,
        decision_request: null,
        decision_taken: null,
        raw_payload: {},
        raw_value: null,
        score_absolute: null,
        score_relative: null,
        tier_used: null,
        completed_at: null,
        llm_insight: null,
      })
      .eq('analysis_id', analysisId)
    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 })
    }

    const { data: allRuns } = await db
      .from('driver_runs')
      .select('driver_key, enabled')
      .eq('analysis_id', analysisId)
    const keys = ((allRuns ?? []) as Array<{ driver_key: string; enabled: boolean }>)
      .filter((r) => r.enabled)
      .map((r) => r.driver_key)
    const { dispatchAll } = await import('@/lib/v4/runner/dispatch')
    const results = await dispatchAll(resolveBaseUrl(request), analysisId, keys)
    await markDispatched(db, analysisId, results.filter((r) => r.dispatched).map((r) => r.driverKey))

    return NextResponse.json(
      { status: 'replaced', from, to, rerun: 'full', drivers: keys },
      { status: 202 },
    )
  }

  // A decision is also the moment to give a job another chance: the analyst
  // just changed the inputs, so the attempts spent on the old ones should not
  // keep it from running.
  const { error: updateError } = await db
    .from('driver_runs')
    .update({
      decision_taken: parsed.decision,
      status: 'queued',
      attempts: 0,
      error: null,
      lease_expires_at: null,
      dispatched_at: null,
    })
    .eq('id', (run as { id: string }).id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const dispatched = await dispatchDriverJob(resolveBaseUrl(request), analysisId, driverKey)
  if (dispatched.dispatched) {
    await markDispatched(db, analysisId, [driverKey])
  }

  return NextResponse.json({ status: 'accepted', driverKey, dispatch: dispatched }, { status: 202 })
}
