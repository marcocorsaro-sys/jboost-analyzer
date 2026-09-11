import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import SetupWizard, { type WizardInitial } from '@/components/v4/SetupWizard'
import { readAttachments } from '@/lib/v4/setup'
import BackLink from '@/components/layout/back-link'
import T from '@/components/ui/T'
import { B } from '@/lib/brand'

export const dynamic = 'force-dynamic'

/**
 * V4 setup — the entry point of the Driver Intelligence Platform pipeline
 * (UX-UI Bibbia 04, "New Audit (Setup)": 5 steps, Save draft + resume).
 *
 * ?resume=<id> reopens a saved setup: the row is loaded HERE, server-side
 * through the user-scoped client (RLS is the access check), reshaped into the
 * wizard's initial state and handed to the client island. A NOT-yet-launched
 * draft resumes as before; a LAUNCHED analysis opens the wizard in
 * edit-post-lancio mode (review item 6): fields editable, save updates
 * setup + configs without resetting the measures, and a final step lets the
 * analyst relaunch chosen drivers with the new setup.
 */
export default async function V4SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; resume?: string }>
}) {
  const { client, resume } = await searchParams

  let initialDraft: WizardInitial | null = null
  if (resume) {
    initialDraft = await loadDraft(resume)
  }

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto' }}>
      {/* Back-affordance: leaving the wizard never loses a saved draft, and
          the Audits list is where drafts resume from. */}
      <BackLink href="/audits">
        <T k="nav.audits" />
      </BackLink>
      <h1
        style={{
          fontSize: '34px',
          fontWeight: 750,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          color: B.ink,
          marginBottom: '10px',
        }}
      >
        <T
          k={
            initialDraft
              ? initialDraft.launched
                ? 'v4setup.edit_title'
                : 'v4setup.resume_title'
              : 'v4setup.title'
          }
        />
      </h1>
      <p style={{ fontSize: '16px', lineHeight: 1.55, color: B.muted, marginBottom: '28px' }}>
        <T k="v4setup.subtitle" />
      </p>

      <SetupWizard clientId={client ?? null} initialDraft={initialDraft} />
    </div>
  )
}

/** analyses row + template_configs → WizardInitial. Redirects when invalid. */
async function loadDraft(analysisId: string): Promise<WizardInitial> {
  const supabase = await createClient()

  const { data: analysis } = await supabase
    .from('analyses')
    .select(
      'id, domain, brand_name, brand_variants, country, output_language, site_type, ' +
        'industry_preset, target_audience, seo_maturity, competitor_details, llm_guardrails, v4_setup',
    )
    .eq('id', analysisId)
    .maybeSingle()
  if (!analysis) redirect('/audits')

  // A started run has driver_runs: the wizard opens in edit-post-lancio mode
  // (review item 6) instead of redirecting away — fields stay editable, the
  // save updates the setup without touching the measures.
  const { count } = await supabase
    .from('driver_runs')
    .select('id', { count: 'exact', head: true })
    .eq('analysis_id', analysisId)
  const launched = (count ?? 0) > 0

  const { data: templateRows } = await supabase
    .from('template_configs')
    .select('site_ref, template_key, url')
    .eq('analysis_id', analysisId)

  const a = analysis as unknown as {
    id: string
    domain: string | null
    brand_name: string | null
    brand_variants: string[] | null
    country: string | null
    output_language: string | null
    site_type: string | null
    industry_preset: string | null
    target_audience: string | null
    seo_maturity: string | null
    competitor_details: Array<{ domain?: string; brand_name?: string | null }> | null
    llm_guardrails: { blocklist?: unknown; max_insights?: unknown } | null
    v4_setup: Record<string, unknown> | null
  }
  const setup = a.v4_setup ?? {}
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

  const templates: Record<string, Record<string, string>> = {}
  for (const row of (templateRows ?? []) as Array<{
    site_ref: string
    template_key: string
    url: string | null
  }>) {
    if (!row.url) continue
    ;(templates[row.site_ref] ??= {})[row.template_key] = row.url
  }

  const guardrails = a.llm_guardrails ?? {}

  return {
    analysisId: a.id,
    launched,
    clientDomain: a.domain ?? '',
    clientBrand: a.brand_name ?? '',
    brandVariants: (a.brand_variants ?? []).join(', '),
    countries: asStrings(setup.countries).length > 0 ? asStrings(setup.countries) : a.country ? [a.country] : [],
    outputLanguage: a.output_language === 'en' ? 'en' : 'it',
    siteType: a.site_type ?? '',
    industryPreset: a.industry_preset ?? '',
    sector: typeof setup.sector === 'string' ? setup.sector : '',
    targetAudienceMode: typeof setup.target_audience_mode === 'string' ? setup.target_audience_mode : '',
    targetAudience: a.target_audience ?? '',
    seoMaturity: a.seo_maturity ?? '',
    competitors: (a.competitor_details ?? []).map((c) => ({
      domain: c.domain ?? '',
      brandName: c.brand_name ?? '',
    })),
    enabledDrivers: asStrings(setup.enabled_drivers),
    jhorizonAnswer: typeof setup.jhorizon_answer === 'string' ? setup.jhorizon_answer : '',
    thematicClusters: asStrings(setup.thematic_clusters),
    blocklist: asStrings(guardrails.blocklist),
    maxInsights: typeof guardrails.max_insights === 'number' ? guardrails.max_insights : null,
    additionalNotes: typeof setup.additional_notes === 'string' ? setup.additional_notes : '',
    driverTemplates:
      setup.driver_templates && typeof setup.driver_templates === 'object'
        ? Object.fromEntries(
            Object.entries(setup.driver_templates as Record<string, unknown>).map(([k, v]) => [
              k,
              asStrings(v),
            ]),
          )
        : {},
    templates,
    attachments: readAttachments(setup),
  }
}
