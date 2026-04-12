import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

export const dynamic = 'force-dynamic'

const VALID_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const
type Frequency = typeof VALID_FREQUENCIES[number]

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/clients/[id]/monitoring
// Read the monitoring subscription for a client. RLS enforces access via
// user_has_client_access (phase4c policies).
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: subscription, error } = await supabase
    .from('client_update_subscriptions')
    .select('*')
    .eq('client_id', params.id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ subscription: subscription ?? null })
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/clients/[id]/monitoring
// Create or update the monitoring subscription. Editor+ access enforced by
// the phase4c RLS policies.
//
// Body fields (all optional, only provided ones are updated):
//   is_active        boolean
//   frequency        'weekly' | 'biweekly' | 'monthly'  (preset)
//   frequency_days   number  (custom override; null clears)
//   enabled_drivers  string[]
//   martech_scan     boolean
//   pagespeed_scan   boolean
//   paused_until     string | null  (ISO timestamp)
// ─────────────────────────────────────────────────────────────────────────────
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active
  if (typeof body.martech_scan === 'boolean') updates.martech_scan = body.martech_scan
  if (typeof body.pagespeed_scan === 'boolean') updates.pagespeed_scan = body.pagespeed_scan
  if (Array.isArray(body.enabled_drivers)) updates.enabled_drivers = body.enabled_drivers

  if (body.frequency !== undefined) {
    if (!VALID_FREQUENCIES.includes(body.frequency as Frequency)) {
      return NextResponse.json(
        { error: `Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(', ')}` },
        { status: 400 }
      )
    }
    updates.frequency = body.frequency
  }

  if (body.frequency_days !== undefined) {
    if (body.frequency_days === null) {
      updates.frequency_days = null
    } else {
      const n = Number(body.frequency_days)
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        return NextResponse.json(
          { error: 'frequency_days must be an integer between 1 and 365' },
          { status: 400 }
        )
      }
      updates.frequency_days = n
    }
  }

  if (body.paused_until !== undefined) {
    if (body.paused_until === null) {
      updates.paused_until = null
    } else {
      const d = new Date(body.paused_until)
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: 'paused_until must be a valid ISO timestamp or null' },
          { status: 400 }
        )
      }
      updates.paused_until = d.toISOString()
    }
  }

  // Recompute next_run_at if the cadence changed and there's no current
  // schedule (or the schedule is overdue). The phase4c SQL helper handles
  // the math; we read the merged values back via a subsequent SELECT after
  // the upsert to keep this endpoint side-effect-clean.
  // Strategy: upsert the row first, then compute and patch next_run_at if
  // needed.

  const { data: upserted, error: upsertError } = await supabase
    .from('client_update_subscriptions')
    .upsert(
      { client_id: params.id, ...updates },
      { onConflict: 'client_id' }
    )
    .select('*')
    .single()

  if (upsertError || !upserted) {
    return NextResponse.json(
      { error: upsertError?.message || 'Failed to upsert subscription' },
      { status: 500 }
    )
  }

  // If the cadence changed and next_run_at is missing or in the past relative
  // to the new cadence, recompute it from now() so the next cron pass picks
  // it up correctly.
  if (
    body.frequency !== undefined ||
    body.frequency_days !== undefined ||
    !upserted.next_run_at
  ) {
    const { data: nextRun } = await supabase.rpc('compute_next_run_at', {
      p_anchor: new Date().toISOString(),
      p_frequency: upserted.frequency,
      p_frequency_days: upserted.frequency_days,
    })
    if (nextRun) {
      await supabase
        .from('client_update_subscriptions')
        .update({ next_run_at: nextRun })
        .eq('client_id', params.id)
      upserted.next_run_at = nextRun as string
    }
  }

  logActivity({
    userId: user.id,
    action: 'monitoring_subscription_updated',
    resourceType: 'client',
    resourceId: params.id,
    details: { fields: Object.keys(updates).filter(k => k !== 'updated_at') },
  }).catch(() => {})

  return NextResponse.json({ subscription: upserted })
}
