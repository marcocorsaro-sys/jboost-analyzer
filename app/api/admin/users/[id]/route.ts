import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return null
  return { supabase, user }
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/users/[id]
// Edit profile fields. Body: { full_name?, company?, role?, is_active? }
// Includes a last-admin guard: an admin cannot demote themselves while
// they are the only admin in the system, and similarly cannot deactivate
// themselves while they are the only active admin.
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin()
  if (!auth) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}

  if (typeof body.full_name === 'string') updates.full_name = body.full_name.trim() || null
  if (typeof body.company === 'string') updates.company = body.company.trim() || null
  if (body.role === 'admin' || body.role === 'user') updates.role = body.role
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Last-admin guard: don't let the system run out of admins.
  if (
    (updates.role === 'user' || updates.is_active === false) &&
    params.id === auth.user.id
  ) {
    const { count } = await adminClient()
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('is_active', true)
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Cannot demote or deactivate the last active admin (yourself)' },
        { status: 409 }
      )
    }
  }

  const { data: updated, error } = await adminClient()
    .from('profiles')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  logActivity({
    userId: auth.user.id,
    action: 'admin_user_updated',
    resourceType: 'user',
    resourceId: params.id,
    details: { fields: Object.keys(updates) },
  }).catch(() => {})

  return NextResponse.json({ user: updated })
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/users/[id]
// Soft delete: set is_active=false and revoke all active sessions in
// auth.users. The profile and client_members rows are preserved so the
// audit trail and historical analyses still resolve. Use POST /purge for
// hard delete.
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin()
  if (!auth) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (params.id === auth.user.id) {
    return NextResponse.json(
      { error: 'You cannot delete your own account from the admin panel' },
      { status: 400 }
    )
  }

  const admin = adminClient()

  // Soft-disable the profile.
  const { error: updateError } = await admin
    .from('profiles')
    .update({ is_active: false })
    .eq('id', params.id)
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Revoke their auth sessions so they cannot continue after the soft-delete.
  // signOut is best-effort — if it fails the soft-delete still stands.
  await admin.auth.admin.signOut(params.id).catch(() => {})

  logActivity({
    userId: auth.user.id,
    action: 'admin_user_soft_deleted',
    resourceType: 'user',
    resourceId: params.id,
  }).catch(() => {})

  return NextResponse.json({ success: true, mode: 'soft' })
}
