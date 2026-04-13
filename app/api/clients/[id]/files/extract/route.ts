import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { extractTextFromFile } from '@/lib/files/extract-text'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/clients/[id]/files/extract
 * Body: { fileId: string }
 *
 * Single-file text extraction. Delegates to lib/files/extract-text.ts.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: clientId } = params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Access enforced by RLS / client_members.
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .single()

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const body = await req.json()
    const { fileId } = body as { fileId: string }
    if (!fileId) {
      return NextResponse.json({ error: 'fileId is required' }, { status: 400 })
    }

    const { data: file } = await supabase
      .from('client_files')
      .select('id, file_name, file_type, storage_path, extraction_status')
      .eq('id', fileId)
      .eq('client_id', clientId)
      .single()

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      )
    }
    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    const result = await extractTextFromFile(adminSupabase, file)

    const { error: updateError } = await adminSupabase
      .from('client_files')
      .update({
        extracted_text: result.extractedText,
        extraction_status: result.status,
      })
      .eq('id', fileId)

    if (updateError) {
      console.error('[File Extract] DB update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to save extraction' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      fileId,
      extraction_status: result.status,
      text_length: result.extractedText?.length || 0,
      raw_length: result.rawLength,
      error: result.error,
    })
  } catch (err) {
    console.error('[File Extract] Unhandled error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
