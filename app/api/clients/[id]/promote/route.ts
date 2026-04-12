import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

// POST /api/clients/[id]/promote
// Admin-only. Promotes a prospect client to 'active', stamps engagement_started_at,
// and ensures a client_update_subscriptions row exists and is active.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // 1. Verify caller is admin
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile || profile.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: only admins can promote clients' },
      { status: 403 }
    )
  }

  // 2. Verify client exists and is currently a prospect
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
        error: `Client is not a prospect (current stage: ${existingClient.lifecycle_stage}). Only prospects can be promoted.`,
      },
      { status: 400 }
    )
  }

  // 3. Update client -> active + stamp engagement_started_at
  const nowIso = new Date().toISOString()
  const { data: updatedClient, error: updateError } = await supabase
    .from('clients')
    .update({
      lifecycle_stage: 'active',
      engagement_started_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', params.id)
    .select()
    .single()

  if (updateError || !updatedClient) {
    return NextResponse.json(
      { error: updateError?.message || 'Failed to promote client' },
      { status: 500 }
    )
  }

  // 4. Upsert client_update_subscriptions: ensure a row exists and is active.
  //    We use upsert on the unique client_id, relying on table defaults for
  //    enabled_drivers / frequency / scan flags.
  const { error: subsError } = await supabase
    .from('client_update_subscriptions')
    .upsert(
      {
        client_id: params.id,
        is_active: true,
      },
      { onConflict: 'client_id' }
    )

  if (subsError) {
    // Non-fatal: the promotion itself has succeeded. Log and surface in
    // response so the caller is aware the subscription was not seeded.
    console.error(
      '[api/clients/promote] Failed to upsert client_update_subscriptions for',
      params.id,
      subsError
    )
  }

  // 5. Activity log (non-blocking)
  logActivity({
    userId: user.id,
    action: 'client_promoted_to_active',
    resourceType: 'client',
    resourceId: params.id,
    details: {
      name: existingClient.name,
      from: 'prospect',
      to: 'active',
      engagement_started_at: nowIso,
      subscription_seeded: !subsError,
    },
  }).catch(() => {})

  return NextResponse.json({
    client: updatedClient,
    subscription_seeded: !subsError,
  })
}
