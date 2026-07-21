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
