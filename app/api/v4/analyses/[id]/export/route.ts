export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadAnalysisSites } from '@/lib/v4/runner/store'
import {
  buildReportModel,
  type ExportAnalysisRow,
  type ExportRunRow,
} from '@/lib/v4/export/report-model'
import { generateDocx } from '@/lib/v4/export/to-docx'
import { generatePptx } from '@/lib/v4/export/to-pptx'
import { generateArtifact } from '@/lib/v4/export/to-artifact'

/**
 * GET /api/v4/analyses/[id]/export — the Output Preview tab's engine.
 *
 *   ?format=pptx|docx|artifact  → generate and stream the deliverable
 *   ?list=1                     → list previous generations (deliverables)
 *
 * WHY generation is synchronous in the request (unlike the driver runner):
 * the generators are pure CPU over rows already in the DB — no external API,
 * no LLM — and finish in well under a second even for 10 drivers. A job
 * queue would add latency and states for nothing.
 *
 * Preconditions: at least ONE driver done. Missing insights or Executive
 * Summary do NOT block the export — the report ships with those narrative
 * sections explicitly marked "not generated" (the analyst may legitimately
 * want a data-only draft). A driver in error is reported as an error with
 * its reason, never as a 0 (sheet 8 null discipline).
 *
 * NO PDF: format=pdf answers 400 with the reason — the V4 spec explicitly
 * de-prioritised PDF (README 01 §8, Bibbia Drivers sheet 2 "Export" row);
 * the supported deliverables are PPTX, Word and the HTML artifact.
 *
 * Every successful generation is registered in public.deliverables
 * (format, who, when) through the user-scoped client, so RLS signs the
 * audit trail with the caller's own identity.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params
  const url = new URL(request.url)

  // AuthN + AuthZ through RLS, exactly like the other V4 analysis routes.
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: analysisData, error: fetchError } = await supabase
    .from('analyses')
    .select('id, domain, brand_name, industry_preset, output_language, ref_date, v4_executive_summary')
    .eq('id', analysisId)
    .maybeSingle()
  if (fetchError || !analysisData) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }
  const analysis = analysisData as unknown as ExportAnalysisRow

  // ------------------------------------------------------------- ?list=1 --
  if (url.searchParams.get('list') === '1') {
    const { data: rows, error: listError } = await supabase
      .from('deliverables')
      .select('id, format, file_ref, generated_by, generated_at')
      .eq('analysis_id', analysisId)
      .order('generated_at', { ascending: false })
      .limit(50)
    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 })
    }
    return NextResponse.json({ analysisId, deliverables: rows ?? [] })
  }

  // ------------------------------------------------------------ generate --
  const format = url.searchParams.get('format')
  if (format === 'pdf') {
    return NextResponse.json(
      {
        error:
          'PDF non previsto: la spec V4 lo de-prioritizza esplicitamente (README 01 §8). ' +
          'I formati supportati sono pptx, docx e artifact (HTML interattivo).',
      },
      { status: 400 },
    )
  }
  if (format !== 'pptx' && format !== 'docx' && format !== 'artifact') {
    return NextResponse.json(
      { error: 'format richiesto: pptx | docx | artifact (oppure ?list=1)' },
      { status: 400 },
    )
  }

  const { data: runData, error: runsError } = await supabase
    .from('driver_runs')
    .select(
      'driver_key, enabled, status, raw_value, score_absolute, score_relative, ' +
        'comment_absolute, comment_relative, tier_used, error, raw_payload, llm_insight',
    )
    .eq('analysis_id', analysisId)
  if (runsError) {
    return NextResponse.json({ error: runsError.message }, { status: 500 })
  }
  const runs = (runData ?? []) as unknown as ExportRunRow[]

  // Precondition: something measured to report. Insights/summary may be
  // missing (sections marked "not generated"), but zero measured drivers
  // would produce an empty shell that only misleads.
  const anyDone = runs.some((r) => r.enabled && r.status === 'done')
  if (!anyDone) {
    return NextResponse.json(
      { error: 'nessun driver completato: il report si genera con almeno un driver done' },
      { status: 409 },
    )
  }

  const { sites } = await loadAnalysisSites(supabase, analysisId)
  const model = buildReportModel(analysis, sites, runs)

  const stamp = new Date().toISOString().slice(0, 10)
  const domainSlug = (analysis.domain ?? analysisId).replace(/[^a-zA-Z0-9.-]+/g, '_')
  const baseName = `jboost-audit-${domainSlug}-${stamp}`

  // Uint8Array<ArrayBuffer> (not ...Like): what Blob/BodyInit accept in TS 5.7.
  let bodyBytes: Uint8Array<ArrayBuffer>
  let fileName: string
  let contentType: string
  let disposition: string
  try {
    if (format === 'pptx') {
      bodyBytes = new Uint8Array(await generatePptx(model))
      fileName = `${baseName}.pptx`
      contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      disposition = `attachment; filename="${fileName}"`
    } else if (format === 'docx') {
      bodyBytes = new Uint8Array(await generateDocx(model))
      fileName = `${baseName}.docx`
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      disposition = `attachment; filename="${fileName}"`
    } else {
      bodyBytes = new TextEncoder().encode(generateArtifact(model))
      fileName = `${baseName}.html`
      // The artifact opens in the browser (inline): it IS the interactive view.
      contentType = 'text/html; charset=utf-8'
      disposition = `inline; filename="${fileName}"`
    }
  } catch (err) {
    return NextResponse.json(
      { error: `generazione ${format} fallita: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  // Register the generation. A failed insert must not eat the file the user
  // asked for: log-and-serve, the deliverable row is bookkeeping.
  const { error: insertError } = await supabase.from('deliverables').insert({
    analysis_id: analysisId,
    format,
    file_ref: fileName,
    generated_by: user.id,
  })
  if (insertError) {
    console.error(`[v4 export] deliverables insert failed for ${analysisId}: ${insertError.message}`)
  }

  // Blob keeps the DOM BodyInit type happy across TS lib versions.
  return new NextResponse(new Blob([bodyBytes]), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      'Cache-Control': 'no-store',
    },
  })
}
