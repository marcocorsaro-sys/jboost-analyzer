import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** Approve / deny a pending OAuth authorization (Claude MCP connector). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    authorization_id?: unknown
    decision?: unknown
  } | null
  const authorizationId = typeof body?.authorization_id === 'string' ? body.authorization_id : ''
  const decision = body?.decision === 'approve' || body?.decision === 'deny' ? body.decision : null
  if (!authorizationId || !decision) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const oauth = (supabase.auth as any).oauth
  if (!oauth) return NextResponse.json({ error: 'OAuth server not available' }, { status: 501 })

  const { data, error } =
    decision === 'approve'
      ? await oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
  if (error || !data?.redirect_url) {
    return NextResponse.json({ error: error?.message ?? 'Authorization failed' }, { status: 400 })
  }
  return NextResponse.json({ redirect_url: data.redirect_url })
}
