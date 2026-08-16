export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAnalysisProgress } from '@/lib/v4/runner/execute'
import { selectRerunDrivers, type RerunEditSlice, type RerunRunSlice } from '@/lib/v4/publish'
import { dispatchAll, resolveBaseUrl } from '@/lib/v4/runner/dispatch'
import { markDispatched } from '@/lib/v4/runner/store'

/**
 * POST /api/v4/analyses/[id]/publish — Save & Publish.
 *
 * Two things happen, in this order:
 *
 * 1. STAMP: every draft edit of the analysis is marked published, in one
 *    batch. Publishing marks a state as the one deliverables may be
 *    generated from; it does not change a single score (the edits were
 *    applied when they were made, because an analyst must see what they did).
 *
 * 2. RE-RUN (Bibbia UX-UI sheets 3/6: "re-runs in BATCH only the drivers
 *    with saved draft edits"): the drivers those drafts belong to are
 *    re-queued and dispatched together, unless the client opts out with
 *    { rerun: false }. The re-run refreshes the raws; the analyst's edited
 *    scores/comments survive it because normalize.ts never overwrites an
 *    `edited` row.
 *
 * Publishing an analysis with drivers still running is refused. A deliverable
 * generated from a half-finished set would be a report about a measurement
 * that had not happened yet.
 */
export async function POST(
  request: Request,
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

  // Optional body; absent body = defaults. Default rerun:true per spec (the
  // batch re-run IS the feature; opting out is the exception).
  let rerunRequested = true
  try {
    const body = (await request.json()) as { rerun?: unknown }
    if (typeof body?.rerun === 'boolean') rerunRequested = body.rerun
  } catch {
    /* no body — keep defaults */
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

  // Snapshot the drafts BEFORE stamping: they define the re-run batch.
  const { data: draftData, error: draftError } = await db
    .from('edits')
    .select('id, driver_run_id, field, published')
    .eq('analysis_id', analysisId)
    .eq('published', false)
  if (draftError) {
    return NextResponse.json({ error: draftError.message }, { status: 500 })
  }
  const drafts = (draftData ?? []) as unknown as Array<RerunEditSlice & { id: string }>

  const { data: published, error: publishError } = await db
    .from('edits')
    .update({ published: true, published_at: publishedAt })
    .eq('analysis_id', analysisId)
    .eq('published', false)
    .select('id')

  if (publishError) {
    return NextResponse.json({ error: publishError.message }, { status: 500 })
  }

  // --- Batch re-run of the edited drivers --------------------------------
  let rerun: { drivers: string[]; ineligible: Array<{ driver_key: string; reason: string }>; dispatchErrors: string[] } = {
    drivers: [],
    ineligible: [],
    dispatchErrors: [],
  }

  if (rerunRequested && drafts.length > 0) {
    const { data: runData, error: runsError } = await db
      .from('driver_runs')
      .select('id, driver_key, enabled, status')
      .eq('analysis_id', analysisId)
    if (runsError) {
      return NextResponse.json(
        {
          status: 'published',
          publishedAt,
          editsPublished: published?.length ?? 0,
          warning: `pubblicato, ma rilancio non avviato: ${runsError.message}`,
        },
        { status: 207 },
      )
    }

    const selection = selectRerunDrivers((runData ?? []) as RerunRunSlice[], drafts)

    if (selection.rerun.length > 0) {
      // Re-queue with fresh attempts (the analyst asked for a new measure)
      // and no lease. `edited`, scores, comments and decision_taken stay:
      // the re-run refreshes the raws, not the analyst's judgement, and a
      // Discoverability re-run keeps the tier the analyst already chose.
      const { error: requeueError } = await db
        .from('driver_runs')
        .update({
          status: 'queued',
          attempts: 0,
          error: null,
          lease_expires_at: null,
          dispatched_at: null,
        })
        .in('id', selection.rerun.map((r) => r.id))
      if (requeueError) {
        return NextResponse.json(
          {
            status: 'published',
            publishedAt,
            editsPublished: published?.length ?? 0,
            warning: `pubblicato, ma rilancio non avviato: ${requeueError.message}`,
          },
          { status: 207 },
        )
      }

      const dispatched = await dispatchAll(
        resolveBaseUrl(request),
        analysisId,
        selection.rerun.map((r) => r.driver_key),
      )
      await markDispatched(
        db,
        analysisId,
        dispatched.filter((d) => d.dispatched).map((d) => d.driverKey),
      )

      rerun = {
        drivers: selection.rerun.map((r) => r.driver_key),
        ineligible: selection.ineligible,
        // A failed dispatch is not fatal: the row is queued and the cron
        // reaper redispatches it. But it must be visible, not swallowed.
        dispatchErrors: dispatched
          .filter((d) => !d.dispatched)
          .map((d) => `${d.driverKey}: ${d.error ?? 'unknown'}`),
      }
    } else {
      rerun = { drivers: [], ineligible: selection.ineligible, dispatchErrors: [] }
    }
  }

  return NextResponse.json({
    status: 'published',
    publishedAt,
    editsPublished: published?.length ?? 0,
    rerun,
    progress,
  })
}

/**
 * GET — the edit log of the analysis, annotated with each edit's driver key
 * (the diff dialog talks in drivers, not run UUIDs), plus the counters the
 * results header needs: pending drafts and the last publish stamp.
 */
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

  const [editsRes, runsRes] = await Promise.all([
    supabase
      .from('edits')
      .select('id, driver_run_id, field, old_value, new_value, published, published_at, created_at')
      .eq('analysis_id', analysisId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('driver_runs')
      .select('id, driver_key, enabled, status')
      .eq('analysis_id', analysisId),
  ])

  if (editsRes.error) return NextResponse.json({ error: editsRes.error.message }, { status: 500 })
  if (runsRes.error) return NextResponse.json({ error: runsRes.error.message }, { status: 500 })

  const keyByRun = new Map(
    ((runsRes.data ?? []) as Array<{ id: string; driver_key: string }>).map((r) => [r.id, r.driver_key]),
  )

  const rows = (editsRes.data ?? []) as Array<{
    id: string
    driver_run_id: string | null
    field: string
    old_value: unknown
    new_value: unknown
    published: boolean
    published_at: string | null
    created_at: string
  }>

  const publishedStamps = rows
    .filter((e) => e.published && e.published_at)
    .map((e) => e.published_at as string)
    .sort()

  return NextResponse.json({
    edits: rows.map((e) => ({
      ...e,
      driver_key: e.driver_run_id ? (keyByRun.get(e.driver_run_id) ?? null) : null,
    })),
    drafts: rows.filter((e) => !e.published).length,
    lastPublishedAt: publishedStamps.length > 0 ? publishedStamps[publishedStamps.length - 1] : null,
    runs: (runsRes.data ?? []),
  })
}
