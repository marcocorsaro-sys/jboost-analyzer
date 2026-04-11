import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

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
