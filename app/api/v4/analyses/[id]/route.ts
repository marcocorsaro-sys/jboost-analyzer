export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSetup, withMandatoryDrivers } from '@/lib/v4/setup'
import { SetupBody, analysisColumnsFromSetup, toSetupInput } from '@/lib/v4/setup-request'
import { planDriverRuns } from '@/lib/v4/runner/planner'
import { saveTemplateConfigs } from '@/lib/v4/runner/store'

/**
 * PATCH /api/v4/analyses/[id] — update a V4 setup that has NOT started yet
 * (save-draft/resume, UX-UI Bibbia 04 "Must support Save draft + resume").
 *
 * The body is the same full wizard state as POST /api/v4/analyses: a draft is
 * replaced wholesale, not merged field by field — the wizard always holds the
 * complete picture, and partial merges are where stale halves come from. The
 * single exception is v4_setup.attachments, owned by the files route and
 * carried over untouched.
 *
 * An analysis whose run has started is immutable here (409): driver_runs
 * already measured THIS setup, and editing it under them would detach every
 * score from its configuration.
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

  let parsed: z.infer<typeof SetupBody>
  try {
    parsed = SetupBody.parse(await request.json())
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
  // /start). head:true + count keeps it a metadata-only query.
  const { count, error: runsError } = await db
    .from('driver_runs')
    .select('id', { count: 'exact', head: true })
    .eq('analysis_id', analysisId)
  if (runsError) {
    return NextResponse.json({ error: `could not check the run state: ${runsError.message}` }, { status: 500 })
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'analysis already started: the setup is immutable once driver runs exist' },
      { status: 409 },
    )
  }

  const clientSite = setup.sites.find((s) => s.is_client)!
  const competitorSites = setup.sites.filter((s) => !s.is_client)

  const { error: updateError } = await db
    .from('analyses')
    .update(
      analysisColumnsFromSetup(
        parsed,
        clientSite,
        competitorSites,
        (analysis as { v4_setup: Record<string, unknown> | null }).v4_setup,
      ),
    )
    .eq('id', analysisId)
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

  return NextResponse.json({
    analysisId,
    mode: parsed.mode,
    sites: setup.sites.map((s) => ({ site_ref: s.site_ref, domain: s.domain })),
    drivers: effectiveDrivers,
    templates: setup.templates.length,
  })
}
