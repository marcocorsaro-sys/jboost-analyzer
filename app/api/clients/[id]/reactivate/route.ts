import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

export const dynamic = 'force-dynamic'

// POST /api/clients/[id]/reactivate
//
// Brings a client back to 'active' from either:
//   - paused state (lifecycle_stage='active' but subscription.is_active=false)
//   - churned state (lifecycle_stage='churned'); the phase4b trigger clears
//     engagement_ended_at automatically on the churned->active transition.
//
// Always re-enables the monitoring subscription. Allowed for owners +
// editors of the client and for admins.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: client, error: fetchError } = await supabase
    .from('clients')
    .select('id, name, lifecycle_stage')
    .eq('id', params.id)
    .single()
  if (fetchError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  let updated = client
  if (client.lifecycle_stage === 'churned') {
    const { data: u, error: updateError } = await supabase
      .from('clients')
      .update({
        lifecycle_stage: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single()
    if (updateError || !u) {
      return NextResponse.json(
        { error: updateError?.message || 'Failed to reactivate client' },
        { status: 500 }
      )
    }
    updated = u
  } else if (client.lifecycle_stage !== 'active') {
    return NextResponse.json(
      {
        error: `Client is in stage '${client.lifecycle_stage}' and cannot be reactivated. Use /promote for prospects.`,
      },
      { status: 400 }
    )
  }

  // Re-enable the monitoring subscription. Upsert in case the row never
  // existed (e.g. legacy client created before phase1b).
  await supabase
    .from('client_update_subscriptions')
    .upsert(
      { client_id: params.id, is_active: true },
      { onConflict: 'client_id' }
    )

  logActivity({
    userId: user.id,
    action: 'client_reactivated',
    resourceType: 'client',
    resourceId: params.id,
    details: { name: client.name, from: client.lifecycle_stage },
  }).catch(() => {})

  return NextResponse.json({ client: updated })
}
