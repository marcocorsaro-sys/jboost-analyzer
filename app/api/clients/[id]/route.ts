import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'
import type { ClientLifecycleStage } from '@/lib/types/client'

export const dynamic = 'force-dynamic'

const VALID_STAGES: ClientLifecycleStage[] = ['prospect', 'active', 'churned', 'archived']

// GET /api/clients/[id] — get client detail
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Access enforced by RLS on clients (client_members-based).
  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json({ client })
}

// PUT /api/clients/[id] — update client
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  // Only include provided fields
  const allowedFields = [
    'name', 'domain', 'industry', 'website_url', 'logo_url',
    'contact_name', 'contact_email', 'contact_phone', 'notes', 'status',
    'lifecycle_stage', 'engagement_started_at', 'engagement_ended_at', 'pre_sales_notes',
  ]
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
    }
  }

  // Validate lifecycle_stage if provided
  if (updates.lifecycle_stage !== undefined) {
    if (!VALID_STAGES.includes(updates.lifecycle_stage as ClientLifecycleStage)) {
      return NextResponse.json(
        { error: `Invalid lifecycle_stage. Must be one of: ${VALID_STAGES.join(', ')}` },
        { status: 400 }
      )
    }
  }

  // Clean domain if provided
  if (updates.domain && typeof updates.domain === 'string') {
    updates.domain = updates.domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
  }

  // If lifecycle_stage is being changed, we need the previous value to log the transition.
  // RLS enforces edit access via user_can_edit_client().
  let previousStage: ClientLifecycleStage | null = null
  if (updates.lifecycle_stage !== undefined) {
    const { data: existing } = await supabase
      .from('clients')
      .select('lifecycle_stage')
      .eq('id', params.id)
      .single()
    previousStage = (existing?.lifecycle_stage as ClientLifecycleStage | undefined) ?? null
  }

  const { data: client, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log lifecycle transition (non-blocking)
  if (
    updates.lifecycle_stage !== undefined &&
    previousStage !== updates.lifecycle_stage
  ) {
    logActivity({
      userId: user.id,
      action: 'client_lifecycle_changed',
      resourceType: 'client',
      resourceId: params.id,
      details: { from: previousStage, to: updates.lifecycle_stage },
    }).catch(() => {})
  }

  // Log generic update activity (non-blocking)
  logActivity({
    userId: user.id,
    action: 'update_client',
    resourceType: 'client',
    resourceId: params.id,
    details: { updated_fields: Object.keys(updates).filter(k => k !== 'updated_at') },
  }).catch(() => {})

  return NextResponse.json({ client })
}

// DELETE /api/clients/[id]
//   default (?mode=archive)  -> soft delete: status='archived'
//   ?mode=hard               -> hard delete (only allowed for prospects).
//                               Cascades to client_members + knowledge_*
//                               (FK ON DELETE CASCADE).
//
// Hard delete is restricted to prospects so we never destroy a real client's
// history (analyses, monitoring snapshots, audit trail).
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode') === 'hard' ? 'hard' : 'archive'

  if (mode === 'hard') {
    // Pre-flight: only prospects can be hard-deleted, regardless of role.
    const { data: client, error: fetchError } = await supabase
      .from('clients')
      .select('id, name, lifecycle_stage')
      .eq('id', params.id)
      .single()
    if (fetchError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }
    if (client.lifecycle_stage !== 'prospect') {
      return NextResponse.json(
        {
          error: `Hard delete only allowed for prospects (current: ${client.lifecycle_stage}). Use archive instead.`,
        },
        { status: 400 }
      )
    }

    // RLS DELETE policy requires the caller to be the client's owner or an
    // admin. Cascade deletes drop client_members + knowledge_* rows tied to
    // this client.
    const { error } = await supabase.from('clients').delete().eq('id', params.id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    logActivity({
      userId: user.id,
      action: 'client_hard_deleted',
      resourceType: 'client',
      resourceId: params.id,
      details: { name: client.name, was_stage: 'prospect' },
    }).catch(() => {})

    return NextResponse.json({ success: true, mode: 'hard' })
  }

  // Default: soft archive.
  const { error } = await supabase
    .from('clients')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  logActivity({
    userId: user.id,
    action: 'client_archived',
    resourceType: 'client',
    resourceId: params.id,
  }).catch(() => {})

  return NextResponse.json({ success: true, mode: 'archive' })
}
