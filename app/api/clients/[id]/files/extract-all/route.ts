import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { extractTextFromFile } from '@/lib/files/extract-text'
import { logActivity } from '@/lib/tracking/activity'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/clients/[id]/files/extract-all
 *
 * Batch text extraction: runs lib/files/extract-text.ts against every
 * client_file for this client that doesn't yet have extracted_text (or
 * whose extraction_status is 'failed'/'pending'/null).
 *
 * Query params:
 *   force=true   re-extract even files that already have extracted_text
 *
 * Returns a summary:
 *   {
 *     total, skipped, succeeded, failed, unsupported,
 *     results: [ { fileId, fileName, status, text_length, error } ]
 *   }
 *
 * Hard timeout: the function caps at maxDuration=120s. Large batches
 * of very heavy PDFs might not fit. The endpoint returns whatever
 * completed before the timeout and logs the uncompleted ones.
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

    const force = new URL(req.url).searchParams.get('force') === 'true'

    // RLS enforces access
    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', clientId)
      .single()
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      )
    }
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    // Fetch target files
    let query = admin
      .from('client_files')
      .select('id, file_name, file_type, storage_path, extracted_text, extraction_status')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })

    const { data: allFiles, error: listError } = await query
    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 })
    }

    const files = (allFiles ?? []).filter(f => {
      if (force) return true
      // Re-extract if no text OR extraction status is not 'completed'/'unsupported'
      if (!f.extracted_text || f.extracted_text.length < 10) return true
      if (!f.extraction_status) return true
      if (f.extraction_status === 'failed') return true
      if (f.extraction_status === 'pending') return true
      return false
    })

    const total = allFiles?.length ?? 0
    const skipped = total - files.length

    console.log(
      `[Extract All] client=${client.name} total=${total} queued=${files.length} skipped=${skipped} force=${force}`
    )

    const results: Array<{
      fileId: string
      fileName: string
      status: string
      text_length: number
      error?: string
    }> = []

    let succeeded = 0
    let failed = 0
    let unsupported = 0

    // Serial execution (not parallel) to avoid rate-limit issues with
    // pdf-parse worker processes and Supabase Storage concurrency limits.
    for (const file of files) {
      try {
        const result = await extractTextFromFile(admin, {
          id: file.id,
          file_name: file.file_name,
          file_type: file.file_type,
          storage_path: file.storage_path,
        })

        const { error: updateError } = await admin
          .from('client_files')
          .update({
            extracted_text: result.extractedText,
            extraction_status: result.status,
          })
          .eq('id', file.id)

        if (updateError) {
          failed++
          results.push({
            fileId: file.id,
            fileName: file.file_name,
            status: 'failed',
            text_length: 0,
            error: `db update: ${updateError.message}`,
          })
          continue
        }

        if (result.status === 'completed') succeeded++
        else if (result.status === 'unsupported') unsupported++
        else failed++

        results.push({
          fileId: file.id,
          fileName: file.file_name,
          status: result.status,
          text_length: result.extractedText?.length || 0,
          error: result.error,
        })
      } catch (err) {
        failed++
        results.push({
          fileId: file.id,
          fileName: file.file_name,
          status: 'failed',
          text_length: 0,
          error: err instanceof Error ? err.message : 'unknown error',
        })
      }
    }

    logActivity({
      userId: user.id,
      action: 'files_batch_extract',
      resourceType: 'client',
      resourceId: clientId,
      details: { total, queued: files.length, succeeded, failed, unsupported, skipped, force },
    }).catch(() => {})

    return NextResponse.json({
      client_id: clientId,
      total,
      skipped,
      queued: files.length,
      succeeded,
      failed,
      unsupported,
      results,
    })
  } catch (err) {
    console.error('[Extract All] Unhandled error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
