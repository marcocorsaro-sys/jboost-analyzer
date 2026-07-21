export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAnalysisProgress } from '@/lib/v4/runner/execute'

/**
 * POST /api/v4/analyses/[id]/publish — Save & Publish.
 *
 * Stamps every draft edit of the analysis as published, in one batch. That
 * is the whole operation: publishing marks a state as the one deliverables
 * may be generated from, it does not change a single score (the edits were
 * applied when they were made, because an analyst must see what they did).
 *
 * Publishing an analysis with drivers still running is refused. A deliverable
 * generated from a half-finished set would be a report about a measurement
 * that had not happened yet.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: analysis, error: fetchError } = await supabase
    .from('analyses')
    .select('id')
    .eq('id', analysisId)
    .maybeSingle()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  const { progress, error: progressError } = await getAnalysisProgress(supabase, analysisId)
  if (progressError) {
    return NextResponse.json({ error: progressError }, { status: 500 })
  }
  if (progress.pending > 0) {
    return NextResponse.json(
      {
        error: `non pubblicabile: ${progress.pending} driver ancora in coda o in esecuzione`,
        progress,
      },
      { status: 409 },
    )
  }

  const db = createAdminClient()
  const publishedAt = new Date().toISOString()

  const { data: published, error: publishError } = await db
    .from('edits')
    .update({ published: true, published_at: publishedAt })
    .eq('analysis_id', analysisId)
    .eq('published', false)
    .select('id')

  if (publishError) {
    return NextResponse.json({ error: publishError.message }, { status: 500 })
  }

  return NextResponse.json({
    status: 'published',
    publishedAt,
    editsPublished: published?.length ?? 0,
    progress,
  })
}

/** GET — the draft edits still waiting to be published. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('edits')
    .select('id, driver_run_id, field, old_value, new_value, published, published_at, created_at')
    .eq('analysis_id', analysisId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  return NextResponse.json({
    edits: rows,
    drafts: rows.filter((e) => !(e as { published: boolean }).published).length,
  })
}
