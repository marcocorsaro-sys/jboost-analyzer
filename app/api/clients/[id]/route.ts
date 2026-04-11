import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

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

  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
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
  const allowedFields = ['name', 'domain', 'industry', 'website_url', 'logo_url',
    'contact_name', 'contact_email', 'contact_phone', 'notes', 'status']
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
    }
  }

  // Clean domain if provided
  if (updates.domain && typeof updates.domain === 'string') {
    updates.domain = updates.domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
  }

  const { data: client, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log activity (non-blocking)
  logActivity({
    userId: user.id,
    action: 'update_client',
    resourceType: 'client',
    resourceId: params.id,
    details: { updated_fields: Object.keys(updates).filter(k => k !== 'updated_at') },
  }).catch(() => {})

  return NextResponse.json({ client })
}

// DELETE /api/clients/[id] — archive client (soft delete)
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { error } = await supabase
    .from('clients')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log activity (non-blocking)
  logActivity({
    userId: user.id,
    action: 'archive_client',
    resourceType: 'client',
    resourceId: params.id,
  }).catch(() => {})

  return NextResponse.json({ success: true })
}
