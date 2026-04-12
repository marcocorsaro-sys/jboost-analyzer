import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// GET /api/knowledge/documents/[id] — document detail with chunk count
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: document, error } = await supabase
    .from('knowledge_documents')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const { count: chunkCount } = await supabase
    .from('knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('document_id', params.id)

  return NextResponse.json({
    document,
    chunkCount: chunkCount ?? 0,
  })
}

// DELETE /api/knowledge/documents/[id] — delete document (chunks cascade)
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { error } = await supabase
    .from('knowledge_documents')
    .delete()
    .eq('id', params.id)

  if (error) {
    const code = (error as { code?: string }).code
    if (code === '42501' || code === 'PGRST116') {
      return NextResponse.json(
        { error: 'You do not have permission to delete this document' },
        { status: 403 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
