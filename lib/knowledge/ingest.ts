import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { parseDocument } from './parsers'
import { chunkText } from './chunking'
import { embedChunks } from './embedding'
import type { IngestInput, IngestResult, ParsedDocument, Chunk } from './types'

const CHUNK_INSERT_BATCH = 50

export async function ingestDocument(
  input: IngestInput,
  supabaseClient?: SupabaseClient
): Promise<IngestResult> {
  const supabase = supabaseClient ?? (await createClient())

  // 1. Insert pending document row
  const initialMetadata = {
    ...(input.metadata ?? {}),
    fileSize: input.fileBuffer?.length ?? null,
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('knowledge_documents')
    .insert({
      client_id: input.clientId,
      user_id: input.userId,
      source_type: input.sourceType,
      source_name: input.sourceName,
      storage_path: input.storagePath ?? null,
      metadata: initialMetadata,
      ingestion_status: 'pending',
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    const message = insertErr?.message ?? 'Failed to create document row'
    const code = (insertErr as { code?: string } | null)?.code
    const enriched = code ? `${code}: ${message}` : message
    throw Object.assign(new Error(enriched), { code, cause: insertErr })
  }

  const documentId = inserted.id as string

  try {
    // 2. Parsing
    await updateStatus(supabase, documentId, 'parsing')
    const parsed: ParsedDocument = await parseDocument({
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      fileBuffer: input.fileBuffer,
      rawText: input.rawText,
    })

    if (!parsed.rawText || parsed.rawText.trim().length === 0) {
      throw new Error('Parsing produced empty content')
    }

    const mergedMetadata = {
      ...initialMetadata,
      ...parsed.metadata,
      segmentCount: parsed.segments.length,
    }

    const { error: rawUpdateErr } = await supabase
      .from('knowledge_documents')
      .update({
        raw_content: parsed.rawText,
        metadata: mergedMetadata,
        ingestion_status: 'chunking',
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)

    if (rawUpdateErr) {
      throw new Error(`Failed to persist raw content: ${rawUpdateErr.message}`)
    }

    // 3. Chunking
    const chunks: Chunk[] = await chunkText(parsed.rawText)
    if (chunks.length === 0) {
      throw new Error('Chunking produced zero chunks')
    }
    const totalTokens = chunks.reduce((s, c) => s + c.tokenCount, 0)

    // 4. Embedding
    await updateStatus(supabase, documentId, 'embedding')
    const embeddings = await embedChunks(chunks)
    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding count mismatch: ${embeddings.length} vs ${chunks.length}`)
    }

    // 5. Insert chunks in batches. pgvector accepts both JSON arrays and the
    // bracket-literal string form via PostgREST; the literal form is the most
    // reliably accepted across supabase-js versions.
    for (let start = 0; start < chunks.length; start += CHUNK_INSERT_BATCH) {
      const slice = chunks.slice(start, start + CHUNK_INSERT_BATCH)
      const rows = slice.map((c, i) => ({
        document_id: documentId,
        client_id: input.clientId,
        chunk_index: c.index,
        content: c.content,
        content_tokens: c.tokenCount,
        embedding: `[${embeddings[start + i].join(',')}]`,
        metadata: c.metadata,
      }))
      const { error: chunkErr } = await supabase.from('knowledge_chunks').insert(rows)
      if (chunkErr) {
        throw new Error(`Failed to insert chunks batch: ${chunkErr.message}`)
      }
    }

    // 6. Mark ready
    const { error: readyErr } = await supabase
      .from('knowledge_documents')
      .update({
        ingestion_status: 'ready',
        token_count: totalTokens,
        processed_at: new Date().toISOString(),
        ingestion_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)

    if (readyErr) {
      throw new Error(`Failed to mark document ready: ${readyErr.message}`)
    }

    return {
      documentId,
      status: 'ready',
      chunkCount: chunks.length,
      tokenCount: totalTokens,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from('knowledge_documents')
      .update({
        ingestion_status: 'failed',
        ingestion_error: message.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)
    return {
      documentId,
      status: 'failed',
      error: message,
    }
  }
}

async function updateStatus(
  supabase: SupabaseClient,
  documentId: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from('knowledge_documents')
    .update({ ingestion_status: status, updated_at: new Date().toISOString() })
    .eq('id', documentId)
  if (error) {
    throw new Error(`Failed to update status to ${status}: ${error.message}`)
  }
}
