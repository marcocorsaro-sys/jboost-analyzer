export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ATTACHMENT_KINDS,
  readAttachments,
  type AttachmentKind,
  type SetupAttachment,
} from '@/lib/v4/setup'

/**
 * Setup uploads (UX-UI Bibbia 04 fields #15, #20, #23): Screaming Frog crawl
 * for Compliance, backlink export for Authority, knowledge documents.
 *
 * Files go in the SAME storage bucket the knowledge base already uses
 * ('client-files'), under v4-setup/<analysisId>/<kind>/, and only their
 * references are recorded in analyses.v4_setup.attachments. PARSING them in
 * the drivers is a downstream TODO — for now they are listed as "uploaded
 * attachment" in the relevant driver tab (via driver_runs.config at start).
 *
 * Single-file kinds (crawl, backlinks) replace the previous upload; knowledge
 * documents accumulate. Uploads are only accepted while the setup is still a
 * draft, same rule as PATCH: a started run's configuration is immutable.
 */

const MAX_BYTES = 20 * 1024 * 1024

/** Per-kind extension allowlist (the sheet says .csv/.xlsx for the drivers). */
const ALLOWED_EXT: Record<AttachmentKind, string[]> = {
  compliance_crawl: ['.csv', '.xlsx', '.xls'],
  authority_backlinks: ['.csv', '.xlsx', '.xls'],
  knowledge_doc: ['.pdf', '.docx', '.doc', '.txt', '.md', '.pptx', '.xlsx', '.xls', '.csv'],
}

const SINGLE_KINDS: AttachmentKind[] = ['compliance_crawl', 'authority_backlinks']

interface Authorized {
  db: ReturnType<typeof createAdminClient>
  v4Setup: Record<string, unknown>
}

async function authorize(
  analysisId: string,
): Promise<{ ok: Authorized | null; response: NextResponse | null }> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: null, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }

  const { data: analysis, error: fetchError } = await supabase
    .from('analyses')
    .select('id, v4_setup')
    .eq('id', analysisId)
    .single()
  if (fetchError || !analysis) {
    return {
      ok: null,
      response: NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 }),
    }
  }

  const db = createAdminClient()
  const { count } = await db
    .from('driver_runs')
    .select('id', { count: 'exact', head: true })
    .eq('analysis_id', analysisId)
  if ((count ?? 0) > 0) {
    return {
      ok: null,
      response: NextResponse.json(
        { error: 'analysis already started: setup uploads are closed' },
        { status: 409 },
      ),
    }
  }

  return {
    ok: {
      db,
      v4Setup: ((analysis as { v4_setup: Record<string, unknown> | null }).v4_setup ?? {}) as Record<
        string,
        unknown
      >,
    },
    response: null,
  }
}

async function saveAttachments(
  db: ReturnType<typeof createAdminClient>,
  analysisId: string,
  v4Setup: Record<string, unknown>,
  attachments: SetupAttachment[],
): Promise<string | null> {
  const { error } = await db
    .from('analyses')
    .update({ v4_setup: { ...v4Setup, attachments } })
    .eq('id', analysisId)
  return error?.message ?? null
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params
  const { ok, response } = await authorize(analysisId)
  if (!ok) return response!

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }

  const kindRaw = form.get('kind')
  const file = form.get('file')
  if (typeof kindRaw !== 'string' || !ATTACHMENT_KINDS.includes(kindRaw as AttachmentKind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${ATTACHMENT_KINDS.join(', ')}` },
      { status: 400 },
    )
  }
  const kind = kindRaw as AttachmentKind
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart File field)' }, { status: 400 })
  }

  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase()
  if (!ALLOWED_EXT[kind].includes(ext)) {
    return NextResponse.json(
      { error: `unsupported file type "${ext || file.name}" for ${kind} (allowed: ${ALLOWED_EXT[kind].join(', ')})` },
      { status: 400 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length === 0) {
    return NextResponse.json({ error: 'uploaded file is empty' }, { status: 400 })
  }
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (${buffer.length} bytes, max ${MAX_BYTES})` },
      { status: 400 },
    )
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const path = `v4-setup/${analysisId}/${kind}/${Date.now()}_${safeName}`

  const { error: uploadError } = await ok.db.storage
    .from('client-files')
    .upload(path, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (uploadError) {
    return NextResponse.json({ error: `upload failed: ${uploadError.message}` }, { status: 500 })
  }

  const existing = readAttachments(ok.v4Setup)
  // Single-file kinds replace their previous upload (and clean the object).
  const replaced = SINGLE_KINDS.includes(kind) ? existing.filter((a) => a.kind === kind) : []
  const kept = SINGLE_KINDS.includes(kind) ? existing.filter((a) => a.kind !== kind) : existing

  const attachment: SetupAttachment = {
    kind,
    name: file.name,
    path,
    size: buffer.length,
    uploaded_at: new Date().toISOString(),
  }
  const next = [...kept, attachment]

  const saveError = await saveAttachments(ok.db, analysisId, ok.v4Setup, next)
  if (saveError) {
    // The reference is the source of truth: without it the object is orphaned,
    // so remove it rather than leaving an upload nobody can see.
    await ok.db.storage.from('client-files').remove([path])
    return NextResponse.json({ error: `could not record the upload: ${saveError}` }, { status: 500 })
  }

  // Best-effort cleanup of the replaced object; the reference is already gone.
  if (replaced.length > 0) {
    await ok.db.storage.from('client-files').remove(replaced.map((a) => a.path))
  }

  return NextResponse.json({ attachment, attachments: next }, { status: 201 })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params
  const { ok, response } = await authorize(analysisId)
  if (!ok) return response!

  let body: { path?: unknown }
  try {
    body = (await request.json()) as { path?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (typeof body.path !== 'string' || !body.path) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 })
  }

  const existing = readAttachments(ok.v4Setup)
  const target = existing.find((a) => a.path === body.path)
  if (!target) {
    return NextResponse.json({ error: 'attachment not found on this analysis' }, { status: 404 })
  }

  const next = existing.filter((a) => a.path !== body.path)
  const saveError = await saveAttachments(ok.db, analysisId, ok.v4Setup, next)
  if (saveError) {
    return NextResponse.json({ error: `could not remove the reference: ${saveError}` }, { status: 500 })
  }
  // Best-effort: a stale object without a reference is invisible but harmless.
  await ok.db.storage.from('client-files').remove([target.path])

  return NextResponse.json({ attachments: next })
}
