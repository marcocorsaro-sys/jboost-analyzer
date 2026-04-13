// ============================================================
// JBoost — Client Files text extraction (shared helper)
//
// Extracted from app/api/clients/[id]/files/extract/route.ts so the
// logic can be reused by both the single-file endpoint and the new
// batch extract-all endpoint. Pure function: given a file row and an
// admin Supabase client, downloads the storage object, parses it
// based on mime/filename, and returns the extracted text + status.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_TEXT_LENGTH = 50_000 // 50K chars per file

export interface ClientFileRow {
  id: string
  file_name: string
  file_type: string | null
  storage_path: string
}

export interface ExtractResult {
  extractedText: string | null
  status: 'completed' | 'unsupported' | 'failed'
  /** Raw length before truncation */
  rawLength: number
  error?: string
}

/**
 * Extract text from a single client_file row. Downloads the file from
 * Supabase Storage, parses it, returns { extractedText, status }.
 *
 * Never throws — always returns a structured ExtractResult so the caller
 * can decide what to do per-file (e.g. continue batch processing).
 *
 * Caller is responsible for persisting the result back to client_files.
 */
export async function extractTextFromFile(
  adminSupabase: SupabaseClient,
  file: ClientFileRow
): Promise<ExtractResult> {
  // 1. Download from storage
  const { data: fileData, error: downloadError } = await adminSupabase
    .storage
    .from('client-files')
    .download(file.storage_path)

  if (downloadError || !fileData) {
    return {
      extractedText: null,
      status: 'failed',
      rawLength: 0,
      error: `download failed: ${downloadError?.message || 'no data'}`,
    }
  }

  // 2. Parse based on type
  const mimeType = file.file_type?.toLowerCase() || ''
  const fileName = file.file_name.toLowerCase()

  let extractedText: string | null = null
  let status: ExtractResult['status'] = 'completed'

  try {
    if (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'application/xml' ||
      mimeType === 'application/javascript' ||
      fileName.endsWith('.md') ||
      fileName.endsWith('.csv') ||
      fileName.endsWith('.txt') ||
      fileName.endsWith('.json') ||
      fileName.endsWith('.xml') ||
      fileName.endsWith('.yaml') ||
      fileName.endsWith('.yml')
    ) {
      const buffer = Buffer.from(await fileData.arrayBuffer())
      extractedText = buffer.toString('utf-8')
    } else if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
      const { PDFParse } = await import('pdf-parse')
      const buffer = Buffer.from(await fileData.arrayBuffer())
      const parser = new PDFParse({ data: buffer })
      try {
        const textResult = await parser.getText()
        extractedText = textResult.text
      } finally {
        await parser.destroy().catch(() => {})
      }
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.endsWith('.docx')
    ) {
      const mammoth = await import('mammoth')
      const buffer = Buffer.from(await fileData.arrayBuffer())
      const result = await mammoth.extractRawText({ buffer })
      extractedText = result.value
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel' ||
      fileName.endsWith('.xlsx') ||
      fileName.endsWith('.xls')
    ) {
      extractedText = `[File Excel: ${file.file_name}]`
      status = 'completed'
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      fileName.endsWith('.pptx')
    ) {
      extractedText = `[Presentazione: ${file.file_name}]`
      status = 'completed'
    } else if (mimeType.startsWith('image/')) {
      extractedText = `[Immagine: ${file.file_name}]`
      status = 'unsupported'
    } else {
      extractedText = `[File: ${file.file_name} — tipo non supportato per estrazione testo]`
      status = 'unsupported'
    }
  } catch (err) {
    return {
      extractedText: null,
      status: 'failed',
      rawLength: 0,
      error: err instanceof Error ? err.message : 'unknown extraction error',
    }
  }

  const rawLength = extractedText?.length || 0

  // 3. Truncate if needed
  if (extractedText && extractedText.length > MAX_TEXT_LENGTH) {
    extractedText =
      extractedText.substring(0, MAX_TEXT_LENGTH) +
      '\n\n[... testo troncato ...]'
  }

  // 4. Clean whitespace
  if (extractedText) {
    extractedText = extractedText
      .replace(/\r\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
  }

  return { extractedText, status, rawLength }
}
