// Per-driver rerun — re-execute a single driver agent on demand,
// independently of the full analysis pipeline.
//
// Flow:
//   1. Auth + verify the user can edit this client.
//   2. Load the analysis + the existing apiData snapshot for this run.
//   3. Find the agent by name in DRIVER_AGENTS.
//   4. Run it through runAgentWithQuality (same path as the pipeline).
//   5. Update the driver_results row: new score/status + raw_data.agent_quality.
//
// Used by the "Rilancia" button in DriverDetail. Costs ~1-3 Anthropic
// calls (quality loop) per click.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  DRIVER_AGENTS,
  runAgentWithQuality,
  type AgentExecutionContext,
} from '@/lib/agents'
import { logActivity } from '@/lib/tracking/activity'
import { refetchForDriver } from '@/lib/analyses/driver-refetchers'

export const maxDuration = 90
export const dynamic = 'force-dynamic'

interface DriverInputsMap {
  semrush_domain_rank?: Record<string, unknown> | null
  semrush_site_health?: Record<string, unknown> | null
  ahrefs_domain_rating?: Record<string, unknown> | null
  ahrefs_ai_relevance?: Record<string, unknown> | null
  dataforseo_ai_overview?: Record<string, unknown> | null
  psi_mobile?: Record<string, unknown> | null
  trends_brand_awareness?: Record<string, unknown> | null
}

function buildAgentInputs(d: DriverInputsMap): Record<string, unknown> {
  return {
    compliance:       {
      siteHealthData: d.semrush_site_health ?? null,
      psiData:        d.psi_mobile          ?? null,
    },
    experience:       { psiData:         d.psi_mobile           ?? null },
    discoverability:  { domainRankData:  d.semrush_domain_rank  ?? null },
    content:          {
      siteHealthData: d.semrush_site_health ?? null,
      psiData:        d.psi_mobile          ?? null,
      domainRankData: d.semrush_domain_rank ?? null,
    },
    accessibility:    { psiData:         d.psi_mobile           ?? null },
    authority:        { ahrefsData:      d.ahrefs_domain_rating ?? null },
    aso_visibility:   { domainRankData:  d.semrush_domain_rank  ?? null },
    ai_relevance:     {
      ahrefsAiData:    d.ahrefs_ai_relevance  ?? null,
      dataforseoAiData: d.dataforseo_ai_overview ?? null,
    },
    awareness:        { trendsData:      d.trends_brand_awareness ?? null },
  }
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string; name: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // 1. Resolve analysis + client + permissions. RLS will filter, but we
  //    also need the client_id, domain, country, etc. for the context.
  const { data: analysis } = await supabase
    .from('analyses')
    .select('id, client_id, domain, country, language, target_topic, competitors, user_clarifications')
    .eq('id', params.id)
    .single()
  if (!analysis) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
  }

  const { data: canEdit } = await supabase.rpc('user_can_edit_client', { p_client_id: analysis.client_id })
  const { data: isAdmin } = await supabase.rpc('jboost_is_admin')
  if (!canEdit && !isAdmin) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // 2. Find the agent.
  const agent = DRIVER_AGENTS.find(a => a.name === params.name)
  if (!agent) {
    return NextResponse.json({ error: `Unknown driver: ${params.name}` }, { status: 404 })
  }

  // 3. RE-FETCH external data sources for this driver — the whole point of
  // "Rilancia driver" is to get fresh data, not to re-interpret stale/mock
  // bytes from the original run. The deterministic agent is fed live data
  // from SEMrush/PSI/Ahrefs (whichever the driver needs), then the LLM
  // quality loop runs on top.
  //
  // Keys come from app_config first (db-stored, settable from /admin), with
  // env fallback. The fetchers all soft-degrade to mock on failure, so the
  // route never crashes on a missing key — it just returns the same stale
  // result the original analysis had, with diagnostics.
  const { data: cfgRows } = await supabase.from('app_config').select('key, value')
  const dbKeys: Record<string, string> = {}
  for (const r of (cfgRows ?? []) as Array<{ key: string; value: string }>) dbKeys[r.key] = r.value
  const apiKeys = {
    semrushKey: dbKeys.SEMRUSH_API_KEY || process.env.SEMRUSH_API_KEY || '',
    ahrefsKey: dbKeys.AHREFS_API_KEY || process.env.AHREFS_API_KEY || '',
    psiKey: dbKeys.GOOGLE_PSI_API_KEY || process.env.GOOGLE_PSI_API_KEY || '',
    dataforseoLogin: dbKeys.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN || '',
    dataforseoPassword: dbKeys.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD || '',
  }

  const freshData = await refetchForDriver(
    agent.name,
    { domain: analysis.domain ?? '', country: analysis.country ?? 'us' },
    apiKeys,
  )

  // Read existing api_data so we keep dataforseo_ai_overview (it's not in
  // the refetch plan — it's expensive and gated by a flag) etc.
  const { data: apiRows } = await supabase
    .from('api_data')
    .select('source_name, data')
    .eq('analysis_id', params.id)
  const apiDataMap: Record<string, Record<string, unknown> | null> = {}
  for (const row of apiRows || []) {
    const stored = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : null
    const unwrapped = stored && 'data' in stored && '_meta' in stored
      ? (stored as { data: Record<string, unknown> }).data
      : stored
    apiDataMap[row.source_name] = unwrapped
  }

  // Merge: prefer fresh data when present, fall back to stored.
  const merged = { ...apiDataMap, ...freshData }

  // Persist the fresh slices into api_data so subsequent reruns / page
  // refreshes see the same fresh state.
  for (const [sourceName, data] of Object.entries(freshData)) {
    if (!data) continue
    await supabase.from('api_data').upsert({
      analysis_id: params.id,
      source_name: sourceName,
      data: { data, _meta: { is_mock: false, refetched_for: agent.name, refetched_at: new Date().toISOString() } },
      is_mock: false,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'analysis_id,source_name' })
  }

  const driverInputs: DriverInputsMap = {
    semrush_domain_rank: merged.semrush_domain_overview,
    semrush_site_health: merged.semrush_site_health,
    ahrefs_domain_rating: merged.ahrefs_domain_rating,
    ahrefs_ai_relevance: merged.ahrefs_ai_relevance,
    dataforseo_ai_overview: merged.dataforseo_ai_overview,
    psi_mobile: merged.pagespeed_mobile,
    trends_brand_awareness: merged.semrush_brand_awareness,
  }

  const inputs = buildAgentInputs(driverInputs)
  const agentInput = inputs[agent.name]
  if (agentInput === undefined) {
    return NextResponse.json({ error: `No input mapping for ${agent.name}` }, { status: 500 })
  }

  // 4. Build execution context from the analysis row.
  const ctx: AgentExecutionContext = {
    domain: analysis.domain ?? '',
    country: analysis.country ?? undefined,
    language: analysis.language ?? undefined,
    targetTopic: analysis.target_topic ?? undefined,
    competitors: Array.isArray(analysis.competitors) ? analysis.competitors : [],
    priorClarifications: (analysis.user_clarifications as Record<string, string> | null) ?? undefined,
    anthropicKey: process.env.ANTHROPIC_API_KEY || undefined,
  }

  // 5. Run the loop.
  let outcome
  try {
    outcome = await runAgentWithQuality(agent, agentInput, ctx, { maxRetries: 2, verbose: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Agent threw: ${message}` }, { status: 500 })
  }

  const out = outcome.result.output as {
    driverResult: { score: number | null; status: string; details?: Record<string, unknown> }
    interpretation?: string
    source?: string
    excellence?: Record<string, unknown>
  }
  const result = out?.driverResult
  if (!result) {
    return NextResponse.json({ error: 'Agent returned no driverResult' }, { status: 500 })
  }

  const newRawData: Record<string, unknown> = {
    ...(result.details ?? {}),
    agent_quality: {
      methodology_label: agent.label,
      methodology: agent.methodology,
      interpretation: out.interpretation ?? '',
      source: out.source,
      excellence: out.excellence,
      attempts: outcome.attempts,
      passed: outcome.passed,
      final_score: outcome.finalVerdict.score,
      final_verdict: outcome.finalVerdict.verdict,
      history: outcome.history,
      reran_at: new Date().toISOString(),
    },
  }

  // Use service-role for the actual update — supabase JS doesn't reliably
  // populate update affected-row counts when an RLS predicate evaluates
  // false-but-no-error, so the user-role .update() can silently no-op.
  // We've already authorized above (admin OR editor), so service-role is
  // safe here.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  let updateRows: Array<{ id: string }> | null = null
  let updateError: { message: string } | null = null
  if (serviceRoleKey && supabaseUrl) {
    const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const res = await admin
      .from('driver_results')
      .update({ score: result.score, status: result.status, raw_data: newRawData })
      .eq('analysis_id', params.id)
      .eq('driver_name', agent.name)
      .select('id')
    updateRows = res.data ?? null
    updateError = res.error
  } else {
    const res = await supabase
      .from('driver_results')
      .update({ score: result.score, status: result.status, raw_data: newRawData })
      .eq('analysis_id', params.id)
      .eq('driver_name', agent.name)
      .select('id')
    updateRows = res.data ?? null
    updateError = res.error
  }

  if (updateError) {
    return NextResponse.json({ error: `DB update failed: ${updateError.message}` }, { status: 500 })
  }
  if (!updateRows || updateRows.length === 0) {
    return NextResponse.json(
      { error: `Driver row not found for analysis ${params.id} / driver ${agent.name}` },
      { status: 404 },
    )
  }

  logActivity({
    userId: user.id,
    action: 'driver_rerun',
    resourceType: 'analysis',
    resourceId: params.id,
    details: {
      driver_name: agent.name,
      attempts: outcome.attempts,
      passed: outcome.passed,
      new_score: result.score,
    },
  }).catch(() => {})

  return NextResponse.json({
    success: true,
    driver_name: agent.name,
    score: result.score,
    status: result.status,
    agent_quality: newRawData.agent_quality,
  })
}
