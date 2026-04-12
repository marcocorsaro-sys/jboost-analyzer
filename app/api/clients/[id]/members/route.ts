import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'
import type { ClientMember, ClientMemberRole, ClientMemberWithProfile } from '@/lib/types/client'

export const dynamic = 'force-dynamic'

const VALID_ROLES: ClientMemberRole[] = ['owner', 'editor', 'viewer']

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/clients/[id]/members
// List members of a client. RLS on client_members already restricts the
// visible rows to clients the caller can access (user_has_client_access).
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

  // 1. Members rows. RLS handles access control.
  const { data: members, error: membersError } = await supabase
    .from('client_members')
    .select('id, client_id, user_id, role, added_by, added_at')
    .eq('client_id', params.id)
    .order('added_at', { ascending: true })

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 })
  }
  if (!members || members.length === 0) {
    return NextResponse.json({ members: [] })
  }

  // 2. Profile join via two-query pattern. client_members.user_id has a FK
  // to auth.users(id), not to public.profiles(id), so PostgREST cannot infer
  // the relationship — we resolve it ourselves.
  const userIds = Array.from(new Set(members.map(m => m.user_id)))
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, company')
    .in('id', userIds)

  // 3. Email needs the service role (auth.users is not exposed to authenticated).
  // Bail to a null email if the service role isn't configured — the rest of the
  // payload still works.
  let emailById: Record<string, string | null> = {}
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceRoleKey) {
    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )
    // listUsers paginates; for the cardinality we expect (members of one
    // client) listing all users and filtering in-memory is acceptable.
    // Optimisation later: a getUserById per id, in parallel.
    const { data: usersList } = await adminSupabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    if (usersList?.users) {
      emailById = Object.fromEntries(
        usersList.users
          .filter(u => userIds.includes(u.id))
          .map(u => [u.id, u.email ?? null])
      )
    }
  }

  const profileById = Object.fromEntries(
    (profiles ?? []).map(p => [p.id, p])
  )

  const enriched: ClientMemberWithProfile[] = members.map(m => ({
    ...(m as ClientMember),
    full_name: profileById[m.user_id]?.full_name ?? null,
    company: profileById[m.user_id]?.company ?? null,
    email: emailById[m.user_id] ?? null,
  }))

  return NextResponse.json({ members: enriched })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/clients/[id]/members
// Add a new member by email. Caller must be an owner of this client (or admin).
// Body: { email: string, role: 'owner' | 'editor' | 'viewer' }
// ─────────────────────────────────────────────────────────────────────────────
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
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role: ClientMemberRole = body.role && VALID_ROLES.includes(body.role)
    ? body.role
    : 'viewer'

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  // 1. Authorize: caller must be owner of this client OR a global admin.
  // We check both with a single query against the helper functions.
  const { data: ownerCheck } = await supabase
    .from('client_members')
    .select('role')
    .eq('client_id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: adminCheck } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isOwner = ownerCheck?.role === 'owner'
  const isAdmin = adminCheck?.role === 'admin'

  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { error: 'Only the client owner can add members' },
      { status: 403 }
    )
  }

  // 2. Resolve email → user_id via the admin client.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: 'Service role key not configured' },
      { status: 500 }
    )
  }
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  )

  // listUsers paginated lookup. For tenants with hundreds of users this
  // should be replaced by a single getUserByEmail RPC, but Supabase doesn't
  // expose one — listUsers is the supported path.
  const { data: usersList, error: listError } =
    await adminSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }
  const targetUser = usersList?.users.find(u => u.email?.toLowerCase() === email)
  if (!targetUser) {
    return NextResponse.json(
      { error: `No user found with email ${email}` },
      { status: 404 }
    )
  }

  // 3. Insert the member row. Use the user's own client (not service role) so
  // RLS validates the operation a second time and we don't bypass safety nets.
  const { data: inserted, error: insertError } = await supabase
    .from('client_members')
    .insert({
      client_id: params.id,
      user_id: targetUser.id,
      role,
      added_by: user.id,
    })
    .select('id, client_id, user_id, role, added_by, added_at')
    .single()

  if (insertError) {
    // Unique violation = already a member
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'User is already a member of this client' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  logActivity({
    userId: user.id,
    action: 'client_member_added',
    resourceType: 'client',
    resourceId: params.id,
    details: { added_user_id: targetUser.id, role },
  }).catch(() => {})

  return NextResponse.json({ member: inserted })
}
