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
import { parseBacklinksBuffer, BACKLINK_EXPECTED_COLUMNS } from '@/lib/v4/backlinks'
import * as XLSX from 'xlsx'
import {
  parseSemrushCsvText,
  parseSemrushMatrix,
  SEMRUSH_EXPECTED_COLUMNS,
  type SemrushParseResult,
} from '@/lib/v4/semrush-export'

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
 *
 * EXCEPTION (Sprint 1 item 4b): kind 'compliance_semrush' is a per-site
 * MEASUREMENT input (Semrush Site Audit export), parsed at upload
 * (lib/v4/semrush-export.ts) and accepted also after launch — the
 * Compliance tab offers it on error/partial coverage, followed by a force
 * re-measure. Post-launch it is merged into driver_runs.config too, since
 * the run's config was seeded at start.
 */

const MAX_BYTES = 20 * 1024 * 1024

/** Per-kind extension allowlist (the sheet says .csv/.xlsx for the drivers). */
const ALLOWED_EXT: Record<AttachmentKind, string[]> = {
  compliance_crawl: ['.csv', '.xlsx', '.xls'],
  compliance_semrush: ['.csv', '.xlsx', '.xls'],
  authority_backlinks: ['.csv', '.xlsx', '.xls'],
  knowledge_doc: ['.pdf', '.docx', '.doc', '.txt', '.md', '.pptx', '.xlsx', '.xls', '.csv'],
}

const SINGLE_KINDS: AttachmentKind[] = ['compliance_crawl', 'authority_backlinks']

/** Valid site_ref values for the per-site Semrush export (Sprint 1 4b). */
const SITE_REFS = ['client', 'competitor_1', 'competitor_2', 'competitor_3', 'competitor_4']

/**
 * Semrush export -> parsed measurement. CSV goes through the pure text
 * parser; .xlsx/.xls are decoded with the XLSX reader this route already
 * uses for the Ahrefs export and fed to the same pure matrix parser.
 */
function parseSemrushUpload(buffer: Buffer, ext: string): SemrushParseResult {
  if (ext === '.csv') {
    // Semrush exports UTF-8; a UTF-16 BOM round-trip is handled too.
    const text =
      buffer[0] === 0xff && buffer[1] === 0xfe
        ? buffer.toString('utf16le')
        : buffer.toString('utf8')
    return parseSemrushCsvText(text)
  }
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
    const sheetName = workbook.SheetNames[0]
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
    if (!sheet) return { ok: false, error: 'il file non contiene alcun foglio dati' }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
    return parseSemrushMatrix(matrix)
  } catch (err) {
    return {
      ok: false,
      error: `file non leggibile come XLSX (${err instanceof Error ? err.message : String(err)})`,
    }
  }
}

interface Authorized {
  db: ReturnType<typeof createAdminClient>
  v4Setup: Record<string, unknown>
  /** True when driver_runs already exist (the analysis was launched). */
  started: boolean
}

async function authorize(
  analysisId: string,
  opts: { allowStarted?: boolean } = {},
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
  const started = (count ?? 0) > 0
  if (started && !opts.allowStarted) {
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
      started,
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

  // Per-site Semrush export (Sprint 1 item 4b). Unlike the setup uploads it
  // is a MEASUREMENT input, so it stays open after launch: the Compliance
  // tab offers it on error/partial coverage, followed by a force re-measure.
  const siteRefRaw = form.get('site_ref')
  let siteRef = 'client'
  if (kind === 'compliance_semrush') {
    if (typeof siteRefRaw === 'string' && siteRefRaw.trim() !== '') {
      if (!SITE_REFS.includes(siteRefRaw.trim())) {
        return NextResponse.json(
          { error: `site_ref non valido: atteso uno di ${SITE_REFS.join(', ')}` },
          { status: 400 },
        )
      }
      siteRef = siteRefRaw.trim()
    }
  }

  const { ok, response } = await authorize(analysisId, {
    allowStarted: kind === 'compliance_semrush',
  })
  if (!ok) return response!

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
      {
        error:
          `file troppo grande (${(buffer.length / (1024 * 1024)).toFixed(1)} MB, ` +
          `massimo ${MAX_BYTES / (1024 * 1024)} MB)`,
      },
      { status: 400 },
    )
  }

  // Review item 5: the Ahrefs backlink export is parsed AT UPLOAD, with an
  // explicit error (expected columns + size limit) when it does not parse —
  // a standard Ahrefs .csv/.xlsx export must never fail here again. The
  // parsed data (columns, row count, raw sample) is saved on the attachment
  // and reaches the Authority driver config via driverConfigFromSetup;
  // the qualitative use of these rows in the analysis comes downstream.
  let parsed: SetupAttachment['parsed'] = null
  if (kind === 'compliance_semrush') {
    // Parsed at upload (lib/v4/semrush-export.ts, pure): the extracted Site
    // Health IS the measurement the Compliance worker will use for this
    // site (evidence method 'manual_upload'). Unrecognized format = explicit
    // error naming the expected columns, never a stored blob nobody reads.
    const result = parseSemrushUpload(buffer, ext)
    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            `export Semrush Site Audit non valido: ${result.error}. ` +
            `Requisiti: ${SEMRUSH_EXPECTED_COLUMNS}, ` +
            `dimensione massima ${MAX_BYTES / (1024 * 1024)} MB.`,
        },
        { status: 400 },
      )
    }
    parsed = {
      columns: result.parsed.columns,
      row_count: result.parsed.row_count,
      site_health: result.parsed.site_health,
      issues: result.parsed.issues,
    }
  }
  if (kind === 'authority_backlinks') {
    const result = parseBacklinksBuffer(buffer)
    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            `export backlink non valido: ${result.error}. ` +
            `Requisiti: file .csv o .xlsx esportato da Ahrefs, colonne principali ${BACKLINK_EXPECTED_COLUMNS}, ` +
            `dimensione massima ${MAX_BYTES / (1024 * 1024)} MB.`,
        },
        { status: 400 },
      )
    }
    parsed = result.parsed
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
  // The Semrush export replaces PER SITE: one measurement per site_ref.
  const isReplacing = (a: SetupAttachment): boolean =>
    kind === 'compliance_semrush'
      ? a.kind === kind && (a.site_ref ?? 'client') === siteRef
      : SINGLE_KINDS.includes(kind) && a.kind === kind
  const replaced = existing.filter(isReplacing)
  const kept = existing.filter((a) => !isReplacing(a))

  const attachment: SetupAttachment = {
    kind,
    name: file.name,
    path,
    size: buffer.length,
    uploaded_at: new Date().toISOString(),
    ...(kind === 'compliance_semrush' ? { site_ref: siteRef } : {}),
    ...(parsed ? { parsed } : {}),
  }
  const next = [...kept, attachment]

  const saveError = await saveAttachments(ok.db, analysisId, ok.v4Setup, next)
  if (saveError) {
    // The reference is the source of truth: without it the object is orphaned,
    // so remove it rather than leaving an upload nobody can see.
    await ok.db.storage.from('client-files').remove([path])
    return NextResponse.json({ error: `could not record the upload: ${saveError}` }, { status: 500 })
  }

  // Post-launch Semrush upload (item 4b): the run's config was seeded at
  // start, so the new attachment must ALSO reach driver_runs.config, or the
  // force re-measure would still not see it.
  if (ok.started && kind === 'compliance_semrush') {
    const { data: runRow } = await ok.db
      .from('driver_runs')
      .select('id, config')
      .eq('analysis_id', analysisId)
      .eq('driver_key', 'compliance')
      .maybeSingle()
    if (runRow) {
      const config = ((runRow as { config: Record<string, unknown> | null }).config ??
        {}) as Record<string, unknown>
      const list = Array.isArray(config.attachments)
        ? (config.attachments as SetupAttachment[])
        : []
      const merged = [...list.filter((a) => !isReplacing(a)), attachment]
      await ok.db
        .from('driver_runs')
        .update({ config: { ...config, attachments: merged } })
        .eq('id', (runRow as { id: string }).id)
    }
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
