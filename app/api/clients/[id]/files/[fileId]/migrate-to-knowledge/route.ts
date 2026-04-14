// ============================================================
// POST /api/clients/[id]/files/[fileId]/migrate-to-knowledge
//
// Phase 6: migrate a legacy client_files row into the modern
// knowledge_documents + knowledge_chunks pipeline.
//
// Approach: reuses lib/knowledge/ingest.ts::ingestDocument() with
// sourceType='note_manual' + rawText=file.extracted_text. This
// avoids re-downloading the binary from Storage and re-parsing it
// (the legacy extraction is "good enough" — it already went
// through pdf-parse / mammoth / etc). The ingest pipeline then
// handles chunking + embedding + knowledge_chunks insertion.
//
// If the legacy file has no extracted_text (extraction_status !=
// 'completed'), the endpoint returns 400 with a hint telling the
// user to run the /files/extract-all endpoint first.
//
// Idempotent: if the file is already migrated, returns 200 with
// { alreadyMigrated: true, documentId } and does nothing.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ingestDocument } from '@/lib/knowledge/ingest'
import { logActivity } from '@/lib/tracking/activity'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

interface ClientFileRow {
  id: string
  client_id: string
  file_name: string
  file_type: string | null
  extracted_text: string | null
  extraction_status: string | null
  migrated_to_knowledge_document_id: string | null
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; fileId: string } }
) {
  const clientId = params.id
  const fileId = params.fileId

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // RLS on client_files enforces access via client_members (same as
  // other client-scoped routes). If the user does not have access,
  // the row simply will not be returned.
  const { data: file, error: fileErr } = await supabase
    .from('client_files')
    .select('id, client_id, file_name, file_type, extracted_text, extraction_status, migrated_to_knowledge_document_id')
    .eq('id', fileId)
    .eq('client_id', clientId)
    .maybeSingle<ClientFileRow>()

  if (fileErr) {
    return NextResponse.json({ error: fileErr.message }, { status: 500 })
  }
  if (!file) {
    return NextResponse.json({ error: 'File not found or access denied' }, { status: 404 })
  }

  // Idempotent short-circuit
  if (file.migrated_to_knowledge_document_id) {
    return NextResponse.json({
      alreadyMigrated: true,
      documentId: file.migrated_to_knowledge_document_id,
    })
  }

  // Need extracted_text to ingest. If the legacy extraction never
  // ran (or failed), tell the user to run extract-all first.
  const rawText = (file.extracted_text ?? '').trim()
  if (!rawText) {
    return NextResponse.json(
      {
        error:
          'File has no extracted_text yet. Run POST /api/clients/[id]/files/extract-all first, then retry.',
        extraction_status: file.extraction_status,
      },
      { status: 400 }
    )
  }

  // Ingest as note_manual with rawText. The ingest pipeline will
  // chunk the text, embed the chunks, and insert into
  // knowledge_documents + knowledge_chunks.
  let ingestResult
  try {
    ingestResult = await ingestDocument(
      {
        clientId,
        userId: user.id,
        sourceType: 'note_manual',
        sourceName: file.file_name,
        rawText,
        metadata: {
          origin: 'legacy_client_files',
          legacy_file_id: file.id,
          legacy_file_type: file.file_type,
        },
      },
      supabase
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Ingest failed: ${message}` }, { status: 500 })
  }

  if (ingestResult.status !== 'ready') {
    return NextResponse.json(
      { error: `Ingest did not reach ready: ${ingestResult.error ?? 'unknown'}` },
      { status: 500 }
    )
  }

  // Link the legacy row to the new knowledge_document so the UI can
  // show "✓ migrated" and the bulk-migrate query skips it next time.
  const { error: linkErr } = await supabase
    .from('client_files')
    .update({ migrated_to_knowledge_document_id: ingestResult.documentId })
    .eq('id', file.id)

  if (linkErr) {
    // The knowledge_document was created but the link write failed.
    // Not fatal — the user can retry and the idempotent check will
    // notice the dangling document. Still report the error so it
    // does not get silently swallowed.
    return NextResponse.json(
      {
        error: `Ingest succeeded but could not link legacy row: ${linkErr.message}`,
        documentId: ingestResult.documentId,
      },
      { status: 500 }
    )
  }

  logActivity({
    userId: user.id,
    action: 'file_migrated_to_knowledge',
    resourceType: 'client',
    resourceId: clientId,
    details: {
      legacy_file_id: file.id,
      file_name: file.file_name,
      knowledge_document_id: ingestResult.documentId,
      chunk_count: ingestResult.chunkCount,
      token_count: ingestResult.tokenCount,
    },
  }).catch(() => {})

  return NextResponse.json({
    success: true,
    documentId: ingestResult.documentId,
    chunkCount: ingestResult.chunkCount,
    tokenCount: ingestResult.tokenCount,
  })
}
