export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { planDriverRuns, computeRefDate } from '@/lib/v4/runner/planner'
import { seedDriverRuns, loadAnalysisSites, markDispatched } from '@/lib/v4/runner/store'
import { dispatchAll, resolveBaseUrl } from '@/lib/v4/runner/dispatch'

const Body = z.object({
  drivers: z.array(z.string().min(1)).min(1),
  driverConfig: z.record(z.record(z.unknown())).optional(),
})

/**
 * POST /api/v4/analyses/[id]/start
 *
 * Launch a V4 analysis: plan -> seed driver_runs -> fan out one invocation per
 * driver. Returns 202 immediately; progress is polled from the status route.
 *
 * Gating happens BEFORE a single API unit is spent (planner): a Business
 * driver with no competitor, an unknown driver key or a malformed site set is
 * a 400 here, never a run that fails halfway through and bills for it.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params

  // 1. AuthN + AuthZ. The user-scoped client means RLS decides access: if the
  //    SELECT returns nothing, this user has no business with this analysis.
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

  let parsed: z.infer<typeof Body>
  try {
    parsed = Body.parse(await request.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  // 2. From here on the runner owns the rows: service role, no user session.
  const db = createAdminClient()

  const { sites, error: sitesError } = await loadAnalysisSites(db, analysisId)
  if (sitesError) {
    return NextResponse.json({ error: sitesError }, { status: 400 })
  }

  // 3. Plan. Blocking setup errors stop the run before anything is written.
  const plan = planDriverRuns({
    enabledDrivers: parsed.drivers,
    sites,
    driverConfig: parsed.driverConfig,
  })
  if (plan.errors.length > 0) {
    return NextResponse.json({ error: 'setup invalid', details: plan.errors }, { status: 400 })
  }

  // 4. Freeze REF_DATE once, at launch, so every date-accepting endpoint in
  //    this run asks for the same period (sheet 8b).
  const refDate = (analysis as { ref_date: string | null }).ref_date ?? computeRefDate(new Date())
  if (!(analysis as { ref_date: string | null }).ref_date) {
    await db.from('analyses').update({ ref_date: refDate }).eq('id', analysisId)
  }

  // 5. Seed. Idempotent: re-starting an analysis does not duplicate or reset
  //    jobs that already ran.
  const { error: seedError } = await seedDriverRuns(db, analysisId, plan.runs)
  if (seedError) {
    return NextResponse.json({ error: `could not seed driver runs: ${seedError}` }, { status: 500 })
  }

  // 6. Fan out. Dispatch failures are reported, not thrown: the rows stay
  //    'queued' and the cron reaper is the safety net.
  const dispatched = await dispatchAll(
    resolveBaseUrl(request),
    analysisId,
    plan.runs.map((r) => r.driver_key),
  )
  await markDispatched(
    db,
    analysisId,
    dispatched.filter((d) => d.dispatched).map((d) => d.driverKey),
  )

  return NextResponse.json(
    {
      status: 'accepted',
      analysisId,
      refDate,
      drivers: plan.runs.map((r) => r.driver_key),
      dispatch: dispatched,
    },
    { status: 202 },
  )
}
