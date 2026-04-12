import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

export const dynamic = 'force-dynamic'

// POST /api/admin/users/[id]/purge
//
// HARD delete: removes the auth.users row and (via FK ON DELETE CASCADE on
// public.profiles + public.client_members) all references in the app schema.
// Reserved for the cleanup cases where soft-disable isn't enough — gdpr
// erasure, accidental signups, test accounts.
//
// Self-purge is forbidden.
//
// Body must include { confirm: <email> } that exactly matches the target
// user's email; the admin UI uses a typed-confirm dialog to populate this.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (params.id === user.id) {
    return NextResponse.json(
      { error: 'You cannot purge your own account' },
      { status: 400 }
    )
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: 'Service role key not configured' },
      { status: 500 }
    )
  }
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  )

  // Resolve target user.
  const { data: targetAuth, error: getUserError } =
    await admin.auth.admin.getUserById(params.id)
  if (getUserError || !targetAuth?.user) {
    return NextResponse.json(
      { error: getUserError?.message || 'User not found' },
      { status: 404 }
    )
  }

  // Typed-confirm guard.
  const body = await request.json().catch(() => ({}))
  const confirm = typeof body?.confirm === 'string' ? body.confirm.trim().toLowerCase() : ''
  const expected = (targetAuth.user.email || '').toLowerCase()
  if (!expected || confirm !== expected) {
    return NextResponse.json(
      {
        error:
          'Confirmation mismatch. Provide { confirm: <email> } exactly matching the user email.',
      },
      { status: 400 }
    )
  }

  // Last-admin guard: never purge the last active admin.
  const { count: adminCount } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true)
  if ((adminCount ?? 0) <= 1) {
    const { data: targetProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', params.id)
      .single()
    if (targetProfile?.role === 'admin') {
      return NextResponse.json(
        { error: 'Cannot purge the last active admin' },
        { status: 409 }
      )
    }
  }

  // Delete the auth user. profiles + client_members rows cascade if their
  // FKs are set up; the phase4e migration adds those guards explicitly.
  const { error: deleteError } = await admin.auth.admin.deleteUser(params.id)
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  logActivity({
    userId: user.id,
    action: 'admin_user_purged',
    resourceType: 'user',
    resourceId: params.id,
    details: { email: expected },
  }).catch(() => {})

  return NextResponse.json({ success: true, mode: 'hard' })
}
