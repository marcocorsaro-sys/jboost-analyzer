export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAnalysisProgress, recoverAnalysisStaleRuns } from '@/lib/v4/runner/execute'
import { selectStaleRuns } from '@/lib/v4/runner/reaper'
import { readSites } from '@/lib/v4/runner/normalize'
import { loadAnalysisSites, loadTemplateConfigs } from '@/lib/v4/runner/store'
import { resolveBaseUrl } from '@/lib/v4/runner/dispatch'
import { buildJhorizonPrompt } from '@/lib/v4/drivers/jhorizon-extract'
import { linkedClientId } from '@/lib/v4/promote'

/**
 * GET /api/v4/analyses/[id]/status
 *
 * Poll endpoint for the results page: one row per driver with its state,
 * scores and — when it failed — the actual reason. No aggregate that hides a
 * failure behind a number: a driver in 'error' shows as 'error', never as 0.
 *
 * Read through the user-scoped client so RLS decides access, exactly like the
 * V1 routes; driver_runs carries the phase8 checkpoint RLS model.
 */
export async function GET(
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
    .select('id, ref_date, domain, brand_name, client_id, v4_setup, industry_preset, country')
    .eq('id', analysisId)
    .single()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  let { rows, progress, error } = await getAnalysisProgress(supabase, analysisId)
  if (error) {
    return NextResponse.json({ error }, { status: 500 })
  }

  // --- On-demand recovery (Sprint 1 item 1a) ------------------------------
  // This route is polled every 5s by the results page: a run whose worker
  // died (lease expired > 30s ago) is recovered HERE, at the next poll,
  // instead of hanging "running" until the 04:00 UTC cron. The pure
  // selection is the cron reaper's own (selectStaleRuns); the writes are
  // status-guarded and the redispatch goes through the atomic claim, so a
  // concurrent poll or cron pass cannot double-run anything. The service
  // role is used only AFTER RLS confirmed this user can see the analysis.
  const stale = selectStaleRuns(rows, new Date())
  if (stale.requeue.length > 0 || stale.fail.length > 0) {
    try {
      const admin = createAdminClient()
      const summary = await recoverAnalysisStaleRuns(
        admin,
        analysisId,
        rows,
        resolveBaseUrl(request),
      )
      if (summary.errors.length > 0) {
        console.error('[v4/status] recovery errors:', summary.errors.join(' | '))
      }
      // Re-read so the response reflects the recovered states (queued /
      // error), not the stale 'running' the client would poll away anyway.
      const refreshed = await getAnalysisProgress(supabase, analysisId)
      if (!refreshed.error) {
        rows = refreshed.rows
        progress = refreshed.progress
      }
    } catch (err) {
      // Recovery is best-effort: the poll answer must never fail because of
      // it (the cron remains the safety net).
      console.error('[v4/status] recovery threw:', err)
    }
  }

  // The analyzed set (client + competitors) as configured in setup. The
  // results shell needs it BEFORE any driver completes: the Content
  // questionnaire tabs and the chart labels are per-site.
  const { sites } = await loadAnalysisSites(supabase, analysisId)

  // PSI run context (Sprint 1 item 1b): how many pages × sites the Speed and
  // Accessibility sweeps measure, so the UI can say what is taking minutes.
  // Same page-selection rule as urlsForSite: configured templates with a URL,
  // homepage-only fallback.
  const { templates } = await loadTemplateConfigs(supabase, analysisId)
  const psiPages = sites.reduce((acc, s) => {
    const configured = templates.filter((t) => t.site_ref === s.site_ref && t.url).length
    return acc + (configured > 0 ? configured : 1)
  }, 0)

  // J-Horizon copy-prompt (Sprint 1 item 3): regenerated from the CURRENT
  // site set with the same function the worker uses, so the AI Visibility
  // tab can always offer it, even when the original decision_request is gone
  // (driver measured from setup paste or from an old pause).
  const jhorizonPrompt = sites.length > 0 ? buildJhorizonPrompt(sites) : null

  return NextResponse.json({
    analysisId,
    refDate: (analysis as { ref_date: string | null }).ref_date,
    domain: (analysis as { domain: string | null }).domain,
    brandName: (analysis as { brand_name: string | null }).brand_name,
    // Header meta (industry · country · REF_DATE) — columns setup already
    // writes; presentation only, no extra queries.
    industryPreset: (analysis as { industry_preset: string | null }).industry_preset,
    country: (analysis as { country: string | null }).country,
    // The client this audit is tied to (promotion or wizard pick) — feeds
    // the results header's Switch-to-client button / "Cliente" chip.
    clientId: linkedClientId(
      analysis as { client_id: string | null; v4_setup: Record<string, unknown> | null },
    ),
    // Note globali di progetto (review 12): lette dal jsonb del setup, il
    // pannello Note della pagina risultati le mostra e le salva via PATCH.
    globalNotes:
      typeof (analysis as { v4_setup: Record<string, unknown> | null }).v4_setup?.global_notes ===
      'string'
        ? ((analysis as { v4_setup: Record<string, unknown> }).v4_setup.global_notes as string)
        : null,
    sites: sites.map((s) => ({
      site_ref: s.site_ref,
      domain: s.domain,
      name: s.name,
      is_client: s.is_client,
    })),
    progress,
    drivers: rows.map((r) => ({
      driver_key: r.driver_key,
      status: r.status,
      enabled: r.enabled,
      raw_value: r.raw_value,
      score_absolute: r.score_absolute,
      score_relative: r.score_relative,
      comment_absolute: r.comment_absolute,
      comment_relative: r.comment_relative,
      tier_used: r.tier_used,
      edited: r.edited,
      attempts: r.attempts,
      max_attempts: r.max_attempts,
      error: r.error,
      started_at: r.started_at,
      completed_at: r.completed_at,
      // Coverage transparency (Sprint 1 item 4a): the worker's own partial
      // note ("misurato N siti su M; mancano ...") travels to the UI as an
      // amber banner, same treatment as the PSI coverage note.
      partial_note:
        typeof (r.raw_payload as { partial_note?: unknown })?.partial_note === 'string'
          ? ((r.raw_payload as { partial_note: string }).partial_note)
          : null,
      // Running context (item 1b): what Speed/Accessibility are measuring.
      ...(r.driver_key === 'speed' || r.driver_key === 'accessibility'
        ? { psi_plan: { pages: psiPages, sites: sites.length } }
        : {}),
      // Item 3: the AI Visibility tab can always rebuild the copy-prompt.
      ...(r.driver_key === 'ai_visibility' ? { jhorizon_prompt: jhorizonPrompt } : {}),
      sites: readSites(r),
      // Setup uploads bound to this driver (Screaming Frog crawl, backlink
      // export): listed in the tab as "uploaded attachment". Parsing them is
      // a downstream TODO — the reference is the whole contract for now.
      attachments: Array.isArray((r.config as { attachments?: unknown })?.attachments)
        ? (r.config as { attachments: unknown[] }).attachments
        : [],
      decision_request:
        r.status === 'needs_decision'
          ? ((r.raw_payload as { decision_request?: unknown })?.decision_request ?? null)
          : null,
    })),
  })
}
