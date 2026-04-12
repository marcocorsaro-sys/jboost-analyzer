import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { embedQuery } from '@/lib/knowledge/embedding'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/knowledge/search — vector search over a client's knowledge base
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: { clientId?: string; query?: string; topK?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { clientId, query } = body
  const topK = clamp(body.topK ?? 10, 1, 50)

  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  }
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  let embedding: number[]
  try {
    embedding = await embedQuery(query)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Embedding failed: ${message}` }, { status: 500 })
  }

  // pgvector RPC expects a string-encoded vector literal
  const embeddingLiteral = `[${embedding.join(',')}]`

  const { data, error } = await supabase.rpc('search_knowledge_chunks', {
    p_client_id: clientId,
    p_query_embedding: embeddingLiteral,
    p_limit: topK,
  })

  if (error) {
    const code = (error as { code?: string }).code
    if (code === '42501' || code === 'PGRST116') {
      return NextResponse.json(
        { error: 'You do not have permission to search this client knowledge base' },
        { status: 403 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    query,
    topK,
    results: data ?? [],
  })
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
