/**
 * MCP connector endpoint (Streamable HTTP, JSON responses only).
 * POST = JSON-RPC 2.0 message(s). Auth: Supabase OAuth access token, verified
 * on every request. Tools run as that user (RLS preserved).
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  bearerTokenFromHeader,
  publicOrigin,
  verifyAccessToken,
  wwwAuthenticate,
} from '@/lib/mcp/auth'
import { handleBody, internalErrorResponse, parseErrorResponse } from '@/lib/mcp/jsonrpc'
import { MCP_TOOLS } from '@/lib/mcp/tools'
import { recordToolCall } from '@/lib/mcp/usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...extra } })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

// No server-initiated stream and no sessions: tell the client so (spec-compliant).
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } })
}
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } })
}

export async function POST(request: NextRequest) {
  const origin = publicOrigin(request)
  const token = bearerTokenFromHeader(request.headers.get('authorization'))
  const principal = token ? await verifyAccessToken(token) : null
  if (!principal) {
    return json(
      { error: token ? 'invalid_token' : 'unauthorized', error_description: 'Sign in with your J-Boost Analyzer account.' },
      401,
      { 'WWW-Authenticate': wwwAuthenticate(origin, token ? 'invalid_token' : undefined) },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(parseErrorResponse(), 400)
  }

  try {
    const reply = await handleBody(body, {
      tools: MCP_TOOLS,
      ctx: { userId: principal.userId, email: principal.email, origin },
      onToolCall: (record) => recordToolCall(principal, record),
    })
    if (reply === null) return new NextResponse(null, { status: 202, headers: CORS })
    return json(reply)
  } catch (err) {
    return json(internalErrorResponse(err instanceof Error ? err.message : 'Internal error'), 500)
  }
}
