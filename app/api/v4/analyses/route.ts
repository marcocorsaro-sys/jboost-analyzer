export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSetup, withMandatoryDrivers } from '@/lib/v4/setup'
import { SetupBody, analysisColumnsFromSetup, toSetupInput } from '@/lib/v4/setup-request'
import { planDriverRuns, computeRefDate } from '@/lib/v4/runner/planner'
import { saveTemplateConfigs } from '@/lib/v4/runner/store'

/**
 * POST /api/v4/analyses — create a V4 analysis from the setup wizard.
 *
 * Two modes (UX-UI Bibbia 04, "Must support Save draft + resume"):
 *   - mode 'draft'  → save whatever the analyst has (only structural errors
 *     block); the setup can be updated later via PATCH /api/v4/analyses/[id]
 *     and resumed in the wizard with ?resume=<id>.
 *   - mode 'launch' → every Required field of the sheet must be present, and
 *     the driver plan must be valid. Starting the run stays a separate call
 *     to /api/v4/analyses/[id]/start.
 *
 * The four Business drivers are pre-flagged AND mandatory: the enabled set is
 * always unioned with them server-side, so no client can un-flag Awareness,
 * AI Visibility, Discoverability or Traffic.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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

  // 1. Site set + templates + field rules (pure, one pass, every problem).
  const setup = buildSetup({ ...toSetupInput(parsed), drivers: effectiveDrivers })

  // 2. Driver gating, on the same site set the run will use. A draft skips
  //    it: an incomplete setup is exactly what a draft is allowed to be.
  const errors = [...setup.errors]
  if (!isDraft) {
    const plan = planDriverRuns({ enabledDrivers: effectiveDrivers, sites: setup.sites })
    errors.push(...plan.errors)
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: 'setup invalid', details: errors }, { status: 400 })
  }

  // 3. If a client was named, the user must actually have access to it. RLS on
  //    the user-scoped client is the check: no row, no permission.
  if (parsed.clientId) {
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', parsed.clientId)
      .maybeSingle()
    if (!client) {
      return NextResponse.json({ error: 'client not found or no access' }, { status: 404 })
    }
  }

  const clientSite = setup.sites.find((s) => s.is_client)!
  const competitorSites = setup.sites.filter((s) => !s.is_client)
  const db = createAdminClient()

  const { data: analysis, error: insertError } = await db
    .from('analyses')
    .insert({
      user_id: user.id,
      client_id: parsed.clientId ?? null,
      status: 'pending',
      source: 'manual',
      ref_date: computeRefDate(new Date()),
      ...analysisColumnsFromSetup(parsed, clientSite, competitorSites, null),
    })
    .select('id, ref_date')
    .single()

  if (insertError || !analysis) {
    return NextResponse.json(
      { error: `could not create the analysis: ${insertError?.message ?? 'unknown'}` },
      { status: 500 },
    )
  }

  const { error: templateError } = await saveTemplateConfigs(
    db,
    analysis.id as string,
    setup.templates,
  )
  if (templateError) {
    // The analysis without its templates would measure the wrong pages.
    // Roll back rather than leave a half-configured setup behind.
    await db.from('analyses').delete().eq('id', analysis.id)
    return NextResponse.json(
      { error: `could not save the page templates: ${templateError}` },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      analysisId: analysis.id,
      refDate: (analysis as { ref_date: string | null }).ref_date,
      mode: parsed.mode,
      sites: setup.sites.map((s) => ({ site_ref: s.site_ref, domain: s.domain })),
      drivers: effectiveDrivers,
      templates: setup.templates.length,
    },
    { status: 201 },
  )
}
