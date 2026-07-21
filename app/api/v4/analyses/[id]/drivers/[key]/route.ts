export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getV4Driver } from '@/lib/scoring/registry'
import { validateEdits } from '@/lib/v4/edits'

/**
 * PATCH /api/v4/analyses/[id]/drivers/[key] — edit a driver's judgement.
 *
 * Applies the edit to the driver_runs row, flags it `edited` (so the next
 * normalization pass leaves it alone instead of recomputing over the
 * analyst) and appends one row per field to `edits` as an unpublished draft.
 *
 * Only scores and comments are editable — see lib/v4/edits.ts for why the raw
 * is not.
 */
export async function PATCH(
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

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const { patches, errors } = validateEdits(body)
  if (errors.length > 0) {
    return NextResponse.json({ error: 'edit invalid', details: errors }, { status: 400 })
  }

  // RLS decides access, and it also gives us the pre-edit values for the
  // audit trail: an edit without its old value is not an audit trail.
  const { data: run, error: fetchError } = await supabase
    .from('driver_runs')
    .select('id, score_relative, score_absolute, comment_relative, comment_absolute')
    .eq('analysis_id', analysisId)
    .eq('driver_key', driverKey)
    .maybeSingle()
  if (fetchError || !run) {
    return NextResponse.json({ error: 'driver run not found or no access' }, { status: 404 })
  }

  const current = run as Record<string, unknown> & { id: string }
  const db = createAdminClient()

  const patch: Record<string, unknown> = { edited: true }
  for (const p of patches) patch[p.field] = p.value

  const { error: updateError } = await db.from('driver_runs').update(patch).eq('id', current.id)
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const { error: logError } = await db.from('edits').insert(
    patches.map((p) => ({
      analysis_id: analysisId,
      driver_run_id: current.id,
      field: p.field,
      old_value: current[p.field] ?? null,
      new_value: p.value,
      author: user.id,
      published: false,
    })),
  )
  if (logError) {
    // The value changed but the trail did not. Say so instead of reporting a
    // clean success: a silent gap in the audit log is worse than a warning.
    return NextResponse.json(
      {
        status: 'partial',
        warning: `modifica applicata ma non registrata nel log: ${logError.message}`,
        applied: patches,
      },
      { status: 207 },
    )
  }

  return NextResponse.json({ status: 'ok', applied: patches, published: false })
}
