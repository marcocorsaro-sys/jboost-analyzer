import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const MAX_TEXT_LENGTH = 50_000 // 50K chars per file

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

    // Get file metadata
    const { data: file } = await supabase
      .from('client_files')
      .select('id, file_name, file_type, storage_path, extraction_status')
      .eq('id', fileId)
      .eq('client_id', clientId)
      .single()

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Download file from storage using service role key
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Service role key not configured' }, { status: 500 })
    }

    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    const { data: fileData, error: downloadError } = await adminSupabase
      .storage
      .from('client-files')
      .download(file.storage_path)

    if (downloadError || !fileData) {
      // Mark as failed
      await adminSupabase
        .from('client_files')
        .update({ extraction_status: 'failed' })
        .eq('id', fileId)

      return NextResponse.json(
        { error: `Download failed: ${downloadError?.message || 'No data'}` },
        { status: 500 }
      )
    }

    // Extract text based on file type
    let extractedText: string | null = null
    let status: string = 'completed'

    const mimeType = file.file_type?.toLowerCase() || ''
    const fileName = file.file_name.toLowerCase()

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
        // Plain text files — read directly
        const buffer = Buffer.from(await fileData.arrayBuffer())
        extractedText = buffer.toString('utf-8')

      } else if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
        // PDF — use pdf-parse v2
        const { PDFParse } = await import('pdf-parse')
        const buffer = Buffer.from(await fileData.arrayBuffer())
        const parser = new PDFParse({ data: buffer })
        const textResult = await parser.getText()
        extractedText = textResult.text
        await parser.destroy()

      } else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        fileName.endsWith('.docx')
      ) {
        // DOCX — use mammoth
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
        // Excel — basic fallback, mark as metadata only
        extractedText = `[File Excel: ${file.file_name}]`
        status = 'completed'

      } else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        fileName.endsWith('.pptx')
      ) {
        // PowerPoint — basic fallback
        extractedText = `[Presentazione: ${file.file_name}]`
        status = 'completed'

      } else if (mimeType.startsWith('image/')) {
        // Images — not extractable as text
        extractedText = `[Immagine: ${file.file_name}]`
        status = 'unsupported'

      } else {
        // Unsupported type
        extractedText = `[File: ${file.file_name} — tipo non supportato per estrazione testo]`
        status = 'unsupported'
      }
    } catch (extractErr) {
      console.error(`[File Extract] Error extracting text from ${file.file_name}:`, extractErr)
      status = 'failed'
      extractedText = null
    }

    // Truncate if needed
    if (extractedText && extractedText.length > MAX_TEXT_LENGTH) {
      extractedText = extractedText.substring(0, MAX_TEXT_LENGTH) + '\n\n[... testo troncato ...]'
    }

    // Clean extracted text (remove excessive whitespace)
    if (extractedText) {
      extractedText = extractedText
        .replace(/\r\n/g, '\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim()
    }

    // Update database
    const { error: updateError } = await adminSupabase
      .from('client_files')
      .update({
        extracted_text: extractedText,
        extraction_status: status,
      })
      .eq('id', fileId)

    if (updateError) {
      console.error('[File Extract] DB update error:', updateError)
      return NextResponse.json({ error: 'Failed to save extraction' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      fileId,
      extraction_status: status,
      text_length: extractedText?.length || 0,
    })
  } catch (err) {
    console.error('[File Extract] Unhandled error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
