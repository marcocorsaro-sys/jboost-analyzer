import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/activity — Client-side activity logging endpoint.
 * Used by login page, knowledge page, etc. to log user actions.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { action, resource_type, resource_id, details } = await req.json()

    if (!action) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 })
    }

    // Extract IP from headers
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

    await supabase.from('activity_logs').insert({
      user_id: user.id,
      action,
      resource_type: resource_type || null,
      resource_id: resource_id || null,
      details: details || null,
      ip_address: ip,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[Activity API] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
