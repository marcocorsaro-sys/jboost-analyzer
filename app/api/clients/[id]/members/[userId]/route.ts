import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'
import type { ClientMemberRole } from '@/lib/types/client'

export const dynamic = 'force-dynamic'

const VALID_ROLES: ClientMemberRole[] = ['owner', 'editor', 'viewer']

// ─────────────────────────────────────────────────────────────────────────────
// Shared authorization helper. Returns { isOwner, isAdmin } or null on auth fail.
// ─────────────────────────────────────────────────────────────────────────────
async function authorize(clientId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: ownerCheck } = await supabase
    .from('client_members')
    .select('role')
    .eq('client_id', clientId)
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: adminCheck } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return {
    supabase,
    user,
    isOwner: ownerCheck?.role === 'owner',
    isAdmin: adminCheck?.role === 'admin',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/clients/[id]/members/[userId]
// Change a member's role. Only owners (and admins) can do this. The system
// must always have at least one owner per client — demoting the last owner
// is rejected.
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; userId: string } }
) {
  const auth = await authorize(params.id)
  if (!auth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!auth.isOwner && !auth.isAdmin) {
    return NextResponse.json(
      { error: 'Only the client owner can change member roles' },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const newRole = body.role as ClientMemberRole | undefined
  if (!newRole || !VALID_ROLES.includes(newRole)) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` },
      { status: 400 }
    )
  }

  // Last-owner guard. If we're about to demote an owner, make sure they aren't
  // the last one — otherwise the client becomes orphaned.
  if (newRole !== 'owner') {
    const { data: target } = await auth.supabase
      .from('client_members')
      .select('role')
      .eq('client_id', params.id)
      .eq('user_id', params.userId)
      .maybeSingle()

    if (!target) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }
    if (target.role === 'owner') {
      const { count } = await auth.supabase
        .from('client_members')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', params.id)
        .eq('role', 'owner')
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last owner of this client' },
          { status: 409 }
        )
      }
    }
  }

  const { data: updated, error } = await auth.supabase
    .from('client_members')
    .update({ role: newRole })
    .eq('client_id', params.id)
    .eq('user_id', params.userId)
    .select('id, client_id, user_id, role, added_by, added_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  logActivity({
    userId: auth.user.id,
    action: 'client_member_role_changed',
    resourceType: 'client',
    resourceId: params.id,
    details: { target_user_id: params.userId, new_role: newRole },
  }).catch(() => {})

  return NextResponse.json({ member: updated })
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/clients/[id]/members/[userId]
// Remove a member. Only owners (and admins) can do this, and the last owner
// cannot be removed (use the archive client flow instead).
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; userId: string } }
) {
  const auth = await authorize(params.id)
  if (!auth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!auth.isOwner && !auth.isAdmin) {
    return NextResponse.json(
      { error: 'Only the client owner can remove members' },
      { status: 403 }
    )
  }

  // Last-owner guard.
  const { data: target } = await auth.supabase
    .from('client_members')
    .select('role')
    .eq('client_id', params.id)
    .eq('user_id', params.userId)
    .maybeSingle()

  if (!target) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  if (target.role === 'owner') {
    const { count } = await auth.supabase
      .from('client_members')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', params.id)
      .eq('role', 'owner')
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove the last owner of this client' },
        { status: 409 }
      )
    }
  }

  const { error } = await auth.supabase
    .from('client_members')
    .delete()
    .eq('client_id', params.id)
    .eq('user_id', params.userId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  logActivity({
    userId: auth.user.id,
    action: 'client_member_removed',
    resourceType: 'client',
    resourceId: params.id,
    details: { removed_user_id: params.userId },
  }).catch(() => {})

  return NextResponse.json({ success: true })
}
