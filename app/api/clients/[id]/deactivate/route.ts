import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

export const dynamic = 'force-dynamic'

// POST /api/clients/[id]/deactivate
//
// Two distinct semantics, picked by `mode` in the body:
//
//   mode = 'pause'
//     Lifecycle stays 'active' but the monitoring subscription is set
//     inactive. Used when an engagement is on hold (vacation, payment
//     pending, etc.). Reversible via /reactivate.
//
//   mode = 'churn'
//     lifecycle_stage -> 'churned'. The phase4b trigger auto-stamps
//     engagement_ended_at. The monitoring subscription is also paused so
//     the cron worker stops refreshing the client. Reversible via
//     /reactivate (which clears engagement_ended_at and brings the client
//     back to 'active').
//
// Authorized for owners + editors of the client (and global admins).
// RLS on clients enforces the access check at the row level too.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const mode: 'pause' | 'churn' = body?.mode === 'churn' ? 'churn' : 'pause'
  const reason: string | null =
    typeof body?.reason === 'string' && body.reason.trim() !== ''
      ? body.reason.trim()
      : null

  // Verify client exists & is currently active (paused is still 'active'
  // lifecycle-wise; only churned/archived/prospect should be rejected here).
  const { data: client, error: fetchError } = await supabase
    .from('clients')
    .select('id, name, lifecycle_stage')
    .eq('id', params.id)
    .single()
  if (fetchError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }
  if (client.lifecycle_stage !== 'active') {
    return NextResponse.json(
      {
        error: `Client is not active (current stage: ${client.lifecycle_stage}).`,
      },
      { status: 400 }
    )
  }

  if (mode === 'churn') {
    const { data: updated, error: updateError } = await supabase
      .from('clients')
      .update({
        lifecycle_stage: 'churned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single()
    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message || 'Failed to churn client' },
        { status: 500 }
      )
    }
    // Pause the subscription so the cron worker stops touching this client.
    await supabase
      .from('client_update_subscriptions')
      .update({ is_active: false })
      .eq('client_id', params.id)

    logActivity({
      userId: user.id,
      action: 'client_churned',
      resourceType: 'client',
      resourceId: params.id,
      details: { name: client.name, reason },
    }).catch(() => {})

    return NextResponse.json({ client: updated, mode: 'churn' })
  }

  // mode === 'pause'
  // Lifecycle stays 'active' — only the subscription is touched.
  const { error: subError } = await supabase
    .from('client_update_subscriptions')
    .update({ is_active: false })
    .eq('client_id', params.id)
  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 500 })
  }

  logActivity({
    userId: user.id,
    action: 'client_paused',
    resourceType: 'client',
    resourceId: params.id,
    details: { name: client.name, reason },
  }).catch(() => {})

  return NextResponse.json({ client, mode: 'pause' })
}
