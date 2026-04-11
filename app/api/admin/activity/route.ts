import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const filterUserId = req.nextUrl.searchParams.get('user_id')
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100', 10)

    let query = supabase
      .from('activity_logs')
      .select('id, user_id, action, resource_type, resource_id, details, ip_address, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (filterUserId) {
      query = query.eq('user_id', filterUserId)
    }

    const { data: logs, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Enrich with user names
    const userIds = Array.from(new Set((logs || []).map(l => l.user_id)))
    let userNames: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)
      for (const p of (profiles || [])) {
        userNames[p.id] = p.full_name || 'N/A'
      }
    }

    const enriched = (logs || []).map(l => ({
      ...l,
      user_name: userNames[l.user_id] || 'N/A',
    }))

    // Also return user list for filter dropdown
    const { data: allUsers } = await supabase
      .from('profiles')
      .select('id, full_name')
      .order('full_name')

    return NextResponse.json({
      logs: enriched,
      users: (allUsers || []).map(u => ({ id: u.id, name: u.full_name || 'N/A' })),
    })
  } catch (err) {
    console.error('[Admin Activity] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
