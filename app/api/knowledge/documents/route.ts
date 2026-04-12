import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// GET /api/knowledge/documents?clientId=...&status=...&limit=...&offset=...
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  const status = url.searchParams.get('status')
  const limitRaw = url.searchParams.get('limit')
  const offsetRaw = url.searchParams.get('offset')

  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  }

  const limit = clamp(parseInt(limitRaw ?? '50', 10) || 50, 1, 200)
  const offset = Math.max(0, parseInt(offsetRaw ?? '0', 10) || 0)

  let query = supabase
    .from('knowledge_documents')
    .select(
      'id, client_id, user_id, source_type, source_name, storage_path, metadata, ingestion_status, ingestion_error, token_count, processed_at, created_at, updated_at',
      { count: 'exact' }
    )
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('ingestion_status', status)
  }

  const { data, error, count } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    documents: data ?? [],
    pagination: { limit, offset, total: count ?? null },
  })
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
