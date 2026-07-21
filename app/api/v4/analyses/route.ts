export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSetup, INDUSTRY_PRESETS } from '@/lib/v4/setup'
import { planDriverRuns, computeRefDate } from '@/lib/v4/runner/planner'
import { saveTemplateConfigs } from '@/lib/v4/runner/store'

const Site = z.object({
  domain: z.string().min(1),
  brandName: z.string().nullable().optional(),
  brandVariants: z.array(z.string()).optional(),
})

const Body = z.object({
  clientId: z.string().uuid().nullable().optional(),
  client: Site,
  competitors: z.array(Site).default([]),
  country: z.string().min(2).default('IT'),
  outputLanguage: z.enum(['it', 'en']).default('it'),
  industryPreset: z.enum(INDUSTRY_PRESETS).nullable().optional(),
  siteType: z.string().nullable().optional(),
  targetAudience: z.string().nullable().optional(),
  seoMaturity: z.enum(['low', 'medium', 'high']).nullable().optional(),
  drivers: z.array(z.string()).min(1),
  templates: z.record(z.record(z.string())).optional(),
})

/**
 * POST /api/v4/analyses — create a V4 analysis from the setup wizard.
 *
 * Creates the analyses row (V4 setup columns) plus its template_configs, and
 * stops there: starting the run is a separate call to
 * /api/v4/analyses/[id]/start, so a setup can be reviewed before spending
 * anything.
 *
 * Everything the wizard can get wrong is rejected BEFORE the row exists —
 * site set, templates, driver gating. An analysis that cannot run should
 * never be created.
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

  let parsed: z.infer<typeof Body>
  try {
    parsed = Body.parse(await request.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  // 1. Site set + templates.
  const setup = buildSetup(parsed)

  // 2. Driver gating, on the same site set the run will use.
  const plan = planDriverRuns({ enabledDrivers: parsed.drivers, sites: setup.sites })
  const errors = [...setup.errors, ...plan.errors]
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
  const db = createAdminClient()

  const { data: analysis, error: insertError } = await db
    .from('analyses')
    .insert({
      user_id: user.id,
      client_id: parsed.clientId ?? null,
      domain: clientSite.domain,
      country: parsed.country,
      language: parsed.outputLanguage,
      // V1 column, kept in sync so the legacy lists keep rendering.
      competitors: setup.sites.filter((s) => !s.is_client).map((s) => s.domain),
      status: 'pending',
      source: 'manual',
      // --- V4 setup fields ---
      brand_name: clientSite.brand_name,
      brand_variants: clientSite.brand_variants ?? [],
      site_type: parsed.siteType ?? null,
      industry_preset: parsed.industryPreset ?? null,
      target_audience: parsed.targetAudience ?? null,
      seo_maturity: parsed.seoMaturity ?? null,
      output_language: parsed.outputLanguage,
      ref_date: computeRefDate(new Date()),
      competitor_details: setup.sites
        .filter((s) => !s.is_client)
        .map((s) => ({
          domain: s.domain,
          brand_name: s.brand_name,
          brand_variants: s.brand_variants ?? [],
        })),
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
      sites: setup.sites.map((s) => ({ site_ref: s.site_ref, domain: s.domain })),
      drivers: plan.runs.map((r) => r.driver_key),
      templates: setup.templates.length,
    },
    { status: 201 },
  )
}
