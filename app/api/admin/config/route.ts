import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Verify the calling user is admin
async function verifyAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return profile?.role === 'admin'
}

// GET — list all config keys (values masked)
export async function GET() {
  const supabase = await createClient()
  if (!(await verifyAdmin(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('app_config')
    .select('key, value, description, updated_at')
    .order('key')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Mask values — show only last 4 characters
  const masked = (data ?? []).map(row => ({
    key: row.key,
    masked_value: row.value.length > 4
      ? '•'.repeat(Math.min(row.value.length - 4, 20)) + row.value.slice(-4)
      : '••••',
    has_value: true,
    description: row.description,
    updated_at: row.updated_at,
  }))

  return NextResponse.json({ keys: masked })
}

// PUT — upsert a config key
export async function PUT(request: Request) {
  const supabase = await createClient()
  if (!(await verifyAdmin(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json()
  const { key, value } = body as { key: string; value: string }

  if (!key || !value) {
    return NextResponse.json({ error: 'Key and value are required' }, { status: 400 })
  }

  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('app_config')
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: user!.id,
    }, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE — remove a config key
export async function DELETE(request: Request) {
  const supabase = await createClient()
  if (!(await verifyAdmin(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json()
  const { key } = body as { key: string }

  if (!key) {
    return NextResponse.json({ error: 'Key is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('app_config')
    .delete()
    .eq('key', key)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
