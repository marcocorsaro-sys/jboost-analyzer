import { NextResponse, type NextRequest } from 'next/server'
import { protectedResourceMetadata, publicOrigin } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  return NextResponse.json(protectedResourceMetadata(publicOrigin(request)), {
    headers: { ...CORS, 'Cache-Control': 'public, max-age=300' },
  })
}
