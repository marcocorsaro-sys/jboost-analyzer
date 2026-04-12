import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ingestDocument } from '@/lib/knowledge/ingest'
import type { KnowledgeSourceType } from '@/lib/knowledge/types'

export const maxDuration = 300
export const runtime = 'nodejs'

// POST /api/knowledge/ingest — multipart upload of a knowledge file
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data body' }, { status: 400 })
  }

  const fileEntry = form.get('file')
  const clientId = form.get('clientId')
  const explicitType = form.get('sourceType')

  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  }
  if (!fileEntry || !(fileEntry instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart File field)' }, { status: 400 })
  }

  const buffer = Buffer.from(await fileEntry.arrayBuffer())
  if (buffer.length === 0) {
    return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 })
  }

  let sourceType: KnowledgeSourceType
  if (typeof explicitType === 'string' && explicitType.length > 0) {
    if (!isKnowledgeSourceType(explicitType)) {
      return NextResponse.json({ error: `Invalid sourceType: ${explicitType}` }, { status: 400 })
    }
    sourceType = explicitType
  } else {
    sourceType = inferSourceType(fileEntry.name, buffer)
  }

  try {
    const result = await ingestDocument({
      clientId,
      userId: user.id,
      sourceType,
      sourceName: fileEntry.name,
      fileBuffer: buffer,
    })

    if (result.status === 'failed') {
      return NextResponse.json(result, { status: 422 })
    }
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string }).code
    if (code === '42501' || code === 'PGRST116') {
      return NextResponse.json(
        { error: 'You do not have permission to add knowledge to this client' },
        { status: 403 }
      )
    }
    if (message.includes('42501') || message.includes('PGRST116')) {
      return NextResponse.json(
        { error: 'You do not have permission to add knowledge to this client' },
        { status: 403 }
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function isKnowledgeSourceType(value: string): value is KnowledgeSourceType {
  return [
    'file_pdf',
    'file_docx',
    'file_xlsx',
    'file_pptx',
    'file_txt',
    'transcript_teams',
    'transcript_generic',
    'note_manual',
    'email',
    'web_clip',
    'ask_j_artifact',
  ].includes(value)
}

function inferSourceType(name: string, buffer: Buffer): KnowledgeSourceType {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'file_pdf'
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'file_docx'
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return 'file_xlsx'
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'file_pptx'
  if (lower.endsWith('.vtt')) return 'transcript_teams'
  if (lower.endsWith('.txt')) {
    const sample = buffer.toString('utf8', 0, Math.min(buffer.length, 4096))
    if (looksLikeTeamsTranscript(sample)) return 'transcript_teams'
    return 'file_txt'
  }
  return 'file_txt'
}

function looksLikeTeamsTranscript(sample: string): boolean {
  if (/<v\s+[^>]+>/i.test(sample)) return true
  if (/-->/.test(sample) && /\d{1,2}:\d{2}:\d{2}/.test(sample)) return true
  if (/^\s*\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s+\S+:\s/m.test(sample)) return true
  return false
}
