import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

// POST /api/clients/[id]/promote
//
// Promote a prospect client to 'active'. Allowed for global admins and for
// any owner/editor member of the client (so a user that created the prospect
// from /pre-sales/new can activate it themselves once the engagement starts).
//
// Optional body: { started_at?: string (ISO date) }
//   If provided, the engagement_started_at is backdated to that value
//   (useful when activating a client retroactively). If omitted, the database
//   trigger introduced in phase4b auto-stamps now().
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // 1. Authorization: admin OR owner/editor of this client.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const isAdmin = profile?.role === 'admin'

  let canEdit = isAdmin
  if (!canEdit) {
    const { data: membership } = await supabase
      .from('client_members')
      .select('role')
      .eq('client_id', params.id)
      .eq('user_id', user.id)
      .maybeSingle()
    canEdit = membership?.role === 'owner' || membership?.role === 'editor'
  }
  if (!canEdit) {
    return NextResponse.json(
      { error: 'Only owners, editors, or admins can promote a prospect' },
      { status: 403 }
    )
  }

  // 2. Verify client is currently a prospect.
  const { data: existingClient, error: fetchError } = await supabase
    .from('clients')
    .select('id, name, lifecycle_stage')
    .eq('id', params.id)
    .single()
  if (fetchError || !existingClient) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }
  if (existingClient.lifecycle_stage !== 'prospect') {
    return NextResponse.json(
      {
        error: `Client is not a prospect (current stage: ${existingClient.lifecycle_stage}).`,
      },
      { status: 400 }
    )
  }

  // 3. Optional backdated start date from body.
  const body = await request.json().catch(() => ({}))
  const startedAt: string | null =
    typeof body?.started_at === 'string' && body.started_at.trim() !== ''
      ? new Date(body.started_at).toISOString()
      : null

  const updates: Record<string, unknown> = {
    lifecycle_stage: 'active',
    updated_at: new Date().toISOString(),
  }
  if (startedAt) {
    updates.engagement_started_at = startedAt
  }
  // If startedAt is null, the phase4b trigger auto-stamps it to now().

  // 4. Update.
  const { data: updatedClient, error: updateError } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (updateError || !updatedClient) {
    return NextResponse.json(
      { error: updateError?.message || 'Failed to promote client' },
      { status: 500 }
    )
  }

  // 5. Upsert subscription so the monitoring loop will pick up this client.
  const { error: subsError } = await supabase
    .from('client_update_subscriptions')
    .upsert(
      { client_id: params.id, is_active: true },
      { onConflict: 'client_id' }
    )
  if (subsError) {
    console.error('[promote] subscription upsert failed', subsError)
  }

  logActivity({
    userId: user.id,
    action: 'client_promoted_to_active',
    resourceType: 'client',
    resourceId: params.id,
    details: {
      name: existingClient.name,
      from: 'prospect',
      to: 'active',
      backdated: !!startedAt,
      engagement_started_at: updatedClient.engagement_started_at,
      subscription_seeded: !subsError,
    },
  }).catch(() => {})

  return NextResponse.json({
    client: updatedClient,
    subscription_seeded: !subsError,
  })
}
