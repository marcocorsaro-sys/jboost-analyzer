import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────────────
// Shared admin gate. Returns the authenticated user + admin status, or null
// if the caller is not authenticated / not admin.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users — list every user with email + membership counts.
// Admin only. Joins profiles + auth.users (via service role) + client_members
// rollup so the admin panel can show "owns N clients, member of M others".
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  const auth = await requireAdmin()
  if (!auth) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  const [
    { data: profiles },
    { data: usersList },
    { data: memberships },
  ] = await Promise.all([
    adminSupabase
      .from('profiles')
      .select('id, full_name, company, role, is_active, created_at')
      .order('created_at', { ascending: false }),
    adminSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    adminSupabase
      .from('client_members')
      .select('user_id, role'),
  ])

  const emailById = Object.fromEntries(
    (usersList?.users ?? []).map(u => [u.id, u.email ?? null])
  )

  const ownerCounts: Record<string, number> = {}
  const sharedCounts: Record<string, number> = {}
  for (const m of memberships ?? []) {
    if (m.role === 'owner') {
      ownerCounts[m.user_id] = (ownerCounts[m.user_id] ?? 0) + 1
    } else {
      sharedCounts[m.user_id] = (sharedCounts[m.user_id] ?? 0) + 1
    }
  }

  const enriched = (profiles ?? []).map(p => ({
    ...p,
    email: emailById[p.id] ?? null,
    owned_clients_count: ownerCounts[p.id] ?? 0,
    shared_clients_count: sharedCounts[p.id] ?? 0,
  }))

  return NextResponse.json({ users: enriched })
}

// POST — create a new user (admin only)
export async function POST(request: Request) {
  // 1. Verify the caller is admin
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  // 2. Parse body
  const body = await request.json()
  const { email, password, full_name, role } = body as {
    email: string
    password: string
    full_name: string
    role: 'user' | 'admin'
  }

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  // 3. Create user with service role key (bypasses email confirmation)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    return NextResponse.json({ error: 'Service role key not configured' }, { status: 500 })
  }

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  )

  const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 400 })
  }

  // 4. Update profile with role and full_name (trigger should create the profile row)
  // Wait a bit for the trigger to fire
  await new Promise(resolve => setTimeout(resolve, 500))

  const { error: updateError } = await adminSupabase
    .from('profiles')
    .update({
      full_name: full_name || null,
      role: role || 'user',
      is_active: true,
    })
    .eq('id', newUser.user.id)

  if (updateError) {
    console.error('Profile update error:', updateError)
    // Not critical — profile trigger may not have fired yet
  }

  // Log activity (non-blocking)
  logActivity({
    userId: user.id,
    action: 'create_user',
    resourceType: 'user',
    resourceId: newUser.user.id,
    details: { email, role: role || 'user' },
  }).catch(() => {})

  return NextResponse.json({
    success: true,
    user: {
      id: newUser.user.id,
      email: newUser.user.email,
    },
  })
}
