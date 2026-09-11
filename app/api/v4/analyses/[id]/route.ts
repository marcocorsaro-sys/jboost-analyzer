export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSetup, withMandatoryDrivers, driverConfigFromSetup } from '@/lib/v4/setup'
import { SetupBody, analysisColumnsFromSetup, toSetupInput } from '@/lib/v4/setup-request'
import { planDriverRuns } from '@/lib/v4/runner/planner'
import { saveTemplateConfigs, seedDriverRuns } from '@/lib/v4/runner/store'

/**
 * PATCH /api/v4/analyses/[id] — three shapes, one route:
 *
 * 1. NOTES-ONLY body { global_notes }: writes analyses.v4_setup.global_notes
 *    (review item 12 — no migration, the jsonb already exists). Works at any
 *    stage, launched or not: the notes are analyst context, not setup.
 *
 * 2. Full wizard body, run NOT started: save-draft/resume (UX-UI Bibbia 04
 *    "Must support Save draft + resume"). The draft is replaced wholesale,
 *    not merged field by field — the wizard always holds the complete
 *    picture. The single exception is v4_setup.attachments, owned by the
 *    files route and carried over untouched.
 *
 * 3. Full wizard body, run ALREADY started (review item 6, minimal honest
 *    version): the setup update is applied WITHOUT resetting a single
 *    measure — analyses columns, template_configs (replaced) and
 *    driver_runs.config (merged per driver) are refreshed; rows for newly
 *    enabled drivers are seeded as 'queued' (idempotent upsert). Statuses,
 *    scores, edits and decisions are untouched: re-measuring under the new
 *    setup is an explicit per-driver relaunch (retry route, force), chosen
 *    by the analyst in the wizard's final step.
 */
export async function PATCH(
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

  // RLS decides access: no row through the user-scoped client, no business.
  const { data: analysis, error: fetchError } = await supabase
    .from('analyses')
    .select('id, v4_setup')
    .eq('id', analysisId)
    .single()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  // --- Shape 1: notes-only patch (review 12) ------------------------------
  const notesBody = raw as { global_notes?: unknown }
  if (notesBody && typeof notesBody === 'object' && 'global_notes' in notesBody) {
    if (typeof notesBody.global_notes !== 'string') {
      return NextResponse.json({ error: 'global_notes deve essere una stringa' }, { status: 400 })
    }
    const existing =
      ((analysis as { v4_setup: Record<string, unknown> | null }).v4_setup ?? {}) as Record<
        string,
        unknown
      >
    const trimmed = notesBody.global_notes.trim()
    const db = createAdminClient()
    const { error: notesError } = await db
      .from('analyses')
      .update({ v4_setup: { ...existing, global_notes: trimmed || null } })
      .eq('id', analysisId)
    if (notesError) {
      return NextResponse.json({ error: notesError.message }, { status: 500 })
    }
    return NextResponse.json({ analysisId, globalNotes: trimmed || null })
  }

  let parsed: z.infer<typeof SetupBody>
  try {
    parsed = SetupBody.parse(raw)
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
  const isDraft = parsed.mode === 'draft'
  const effectiveDrivers = isDraft ? parsed.drivers : withMandatoryDrivers(parsed.drivers)

  const setup = buildSetup({ ...toSetupInput(parsed), drivers: effectiveDrivers })
  const errors = [...setup.errors]
  if (!isDraft) {
    const plan = planDriverRuns({ enabledDrivers: effectiveDrivers, sites: setup.sites })
    errors.push(...plan.errors)
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: 'setup invalid', details: errors }, { status: 400 })
  }

  const db = createAdminClient()

  // Started = at least one driver_runs row exists (they are seeded by
  // /start). Post-launch the setup is still editable (review item 6), but
  // only as a complete, launch-valid save: a half-filled "draft" of a
  // launched analysis would detach the runs from a coherent configuration.
  const { data: runRows, error: runsError } = await db
    .from('driver_runs')
    .select('id, driver_key, config')
    .eq('analysis_id', analysisId)
  if (runsError) {
    return NextResponse.json({ error: `could not check the run state: ${runsError.message}` }, { status: 500 })
  }
  const existingRuns = (runRows ?? []) as Array<{
    id: string
    driver_key: string
    config: Record<string, unknown> | null
  }>
  const started = existingRuns.length > 0
  if (started && isDraft) {
    return NextResponse.json(
      { error: 'analisi già lanciata: salva le modifiche al setup con tutti i campi obbligatori, non come bozza' },
      { status: 409 },
    )
  }

  const clientSite = setup.sites.find((s) => s.is_client)!
  const competitorSites = setup.sites.filter((s) => !s.is_client)

  const columns = analysisColumnsFromSetup(
    parsed,
    clientSite,
    competitorSites,
    (analysis as { v4_setup: Record<string, unknown> | null }).v4_setup,
  )
  const { error: updateError } = await db.from('analyses').update(columns).eq('id', analysisId)
  if (updateError) {
    return NextResponse.json(
      { error: `could not update the analysis: ${updateError.message}` },
      { status: 500 },
    )
  }

  // Replace the template set: a template the analyst removed from the draft
  // must not survive as a stale row (the run has not started, nothing
  // references them yet).
  const { error: clearError } = await db
    .from('template_configs')
    .delete()
    .eq('analysis_id', analysisId)
  if (clearError) {
    return NextResponse.json(
      { error: `could not clear the page templates: ${clearError.message}` },
      { status: 500 },
    )
  }
  const { error: templateError } = await saveTemplateConfigs(db, analysisId, setup.templates)
  if (templateError) {
    return NextResponse.json(
      { error: `could not save the page templates: ${templateError}` },
      { status: 500 },
    )
  }

  // --- Post-launch (review item 6): refresh driver_runs.config, never the
  //     measures. The new setup-derived config is merged over each existing
  //     row's config; rows for newly enabled drivers are seeded 'queued'
  //     (idempotent upsert) so the relaunch step can dispatch them.
  const configWarnings: string[] = []
  if (started) {
    const cfgMap = driverConfigFromSetup(columns.v4_setup as Record<string, unknown>)
    for (const run of existingRuns) {
      const add = cfgMap[run.driver_key]
      if (!add) continue
      const { error: cfgError } = await db
        .from('driver_runs')
        .update({ config: { ...(run.config ?? {}), ...add } })
        .eq('id', run.id)
      if (cfgError) configWarnings.push(`${run.driver_key}: ${cfgError.message}`)
    }

    const have = new Set(existingRuns.map((r) => r.driver_key))
    const newKeys = effectiveDrivers.filter((k) => !have.has(k))
    if (newKeys.length > 0) {
      const newPlan = planDriverRuns({
        enabledDrivers: newKeys,
        sites: setup.sites,
        driverConfig: cfgMap,
      })
      if (newPlan.errors.length > 0) {
        configWarnings.push(`driver non seminabili: ${newPlan.errors.join('; ')}`)
      } else {
        const { error: seedError } = await seedDriverRuns(db, analysisId, newPlan.runs)
        if (seedError) configWarnings.push(`seed driver nuovi fallito: ${seedError}`)
      }
    }
  }

  return NextResponse.json({
    analysisId,
    mode: parsed.mode,
    postLaunch: started,
    ...(configWarnings.length > 0 ? { warnings: configWarnings } : {}),
    sites: setup.sites.map((s) => ({ site_ref: s.site_ref, domain: s.domain })),
    drivers: effectiveDrivers,
    templates: setup.templates.length,
  })
}
