/**
 * Some MCP clients look for authorization-server metadata on OUR origin
 * (older spec revision). Serve Supabase's own document, unchanged.
 */
import { NextResponse } from 'next/server'
import { supabaseAuthIssuer } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET() {
  const issuer = supabaseAuthIssuer()
  if (!issuer) return NextResponse.json({ error: 'not_configured' }, { status: 404, headers: CORS })
  try {
    const base = issuer.replace(/\/auth\/v1$/, '')
    const res = await fetch(`${base}/.well-known/oauth-authorization-server/auth/v1`, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!res.ok) return NextResponse.json({ error: 'oauth_server_unavailable' }, { status: 404, headers: CORS })
    return NextResponse.json(await res.json(), { headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } })
  } catch {
    return NextResponse.json({ error: 'oauth_server_unavailable' }, { status: 502, headers: CORS })
  }
}
