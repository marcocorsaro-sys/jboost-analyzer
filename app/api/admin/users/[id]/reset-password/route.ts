import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

export const dynamic = 'force-dynamic'

// POST /api/admin/users/[id]/reset-password
//
// Sends a password recovery email to the target user (admin only). Uses
// Supabase auth.admin.generateLink to mint the recovery link and rely on
// the project's configured email template / SMTP for delivery.
export async function POST(
  _request: Request,
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

  // Resolve the target user's email.
  const { data: targetAuth, error: getUserError } = await admin.auth.admin.getUserById(
    params.id
  )
  if (getUserError || !targetAuth?.user?.email) {
    return NextResponse.json(
      { error: getUserError?.message || 'User not found or has no email' },
      { status: 404 }
    )
  }

  // Generate a recovery link. Supabase will email it via the project's SMTP
  // template. The redirectTo points back at /reset-password where the app
  // already handles the recovery callback.
  const { error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: targetAuth.user.email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ''}/reset-password`,
    },
  })

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 })
  }

  logActivity({
    userId: user.id,
    action: 'admin_user_password_reset_sent',
    resourceType: 'user',
    resourceId: params.id,
    details: { email: targetAuth.user.email },
  }).catch(() => {})

  return NextResponse.json({ success: true })
}
