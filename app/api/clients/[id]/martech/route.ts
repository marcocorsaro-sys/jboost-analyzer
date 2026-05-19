import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'
import { logActivity } from '@/lib/tracking/activity'
import { martechAgent, runAgentWithQuality } from '@/lib/agents'

export const maxDuration = 180 // increased for web_search + multi-page crawl

// GET /api/clients/[id]/martech — get cached martech stack
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Access enforced by RLS via client_members.
  const { data: client } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('id', params.id)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  // Fetch cached martech
  const { data: martech, error } = await supabase
    .from('client_martech')
    .select('*')
    .eq('client_id', params.id)
    .order('category')
    .order('tool_name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch cached report (completeness + maturity + gaps + recommendations)
  const { data: reportRow } = await supabase
    .from('client_martech_reports')
    .select('completeness')
    .eq('client_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const report = reportRow?.completeness || null

  // Core Web Vitals: read from the latest completed analysis for this
  // client. Mobile has been there since launch; desktop was added in
  // PR6 so older analyses may not have it (returns null for those).
  let cwvMobile: Record<string, unknown> | null = null
  let cwvDesktop: Record<string, unknown> | null = null
  let cwvAnalysisDate: string | null = null
  const { data: latestAnalysis } = await supabase
    .from('analyses')
    .select('id, completed_at')
    .eq('client_id', params.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestAnalysis?.id) {
    cwvAnalysisDate = latestAnalysis.completed_at
    const { data: psiRows } = await supabase
      .from('api_data')
      .select('source_name, data')
      .eq('analysis_id', latestAnalysis.id)
      .in('source_name', ['pagespeed_mobile', 'pagespeed_desktop'])
    for (const row of psiRows || []) {
      const stored = (row.data && typeof row.data === 'object') ? row.data as Record<string, unknown> : null
      const unwrapped = stored && 'data' in stored && '_meta' in stored
        ? (stored as { data: Record<string, unknown> }).data
        : stored
      if (row.source_name === 'pagespeed_mobile') cwvMobile = unwrapped
      if (row.source_name === 'pagespeed_desktop') cwvDesktop = unwrapped
    }
  }

  // "PSI dati MAI vuoti" guarantee — if the latest analysis didn't persist
  // a strategy (older deploy, fetcher failure, resumed analysis), look at
  // the cwv_cache stashed in client_martech_reports, then fall back to a
  // live PSI fetch. Persisted with 7-day TTL so the slow path only fires
  // when truly needed.
  const isEmpty = (d: Record<string, unknown> | null): boolean => {
    if (!d) return true
    const keys = ['performance_score', 'seo_score', 'accessibility_score', 'best_practices_score']
    return keys.every(k => !d[k] || d[k] === 0)
  }
  if (client.domain && (isEmpty(cwvMobile) || isEmpty(cwvDesktop))) {
    const cache = (report?.cwv_cache ?? null) as
      | { mobile?: Record<string, unknown> | null; desktop?: Record<string, unknown> | null; fetched_at?: string }
      | null
    const cacheFreshMs = 7 * 24 * 60 * 60 * 1000
    const cacheAge = cache?.fetched_at ? Date.now() - new Date(cache.fetched_at).getTime() : Infinity
    const cacheFresh = cacheAge < cacheFreshMs
    if (cacheFresh && cache) {
      if (isEmpty(cwvMobile) && !isEmpty(cache.mobile ?? null)) cwvMobile = cache.mobile ?? null
      if (isEmpty(cwvDesktop) && !isEmpty(cache.desktop ?? null)) cwvDesktop = cache.desktop ?? null
    }

    if (isEmpty(cwvMobile) || isEmpty(cwvDesktop)) {
      // Read PSI key from app_config (db) with env fallback. Skip if no key.
      let psiKey = process.env.GOOGLE_PSI_API_KEY || ''
      try {
        const { data: cfgRows } = await supabase
          .from('app_config')
          .select('key, value')
          .eq('key', 'GOOGLE_PSI_API_KEY')
          .maybeSingle()
        if (cfgRows?.value) psiKey = cfgRows.value
      } catch {
        /* ignore — fall back to env */
      }

      if (psiKey) {
        const liveResults = await Promise.allSettled([
          isEmpty(cwvMobile) ? fetchLivePsi(client.domain, psiKey, 'mobile') : Promise.resolve(null),
          isEmpty(cwvDesktop) ? fetchLivePsi(client.domain, psiKey, 'desktop') : Promise.resolve(null),
        ])
        const liveMobile = liveResults[0].status === 'fulfilled' ? liveResults[0].value : null
        const liveDesktop = liveResults[1].status === 'fulfilled' ? liveResults[1].value : null
        if (liveMobile && !isEmpty(liveMobile)) cwvMobile = liveMobile
        if (liveDesktop && !isEmpty(liveDesktop)) cwvDesktop = liveDesktop

        // Persist whatever we got (best-effort, non-blocking on failure) so
        // subsequent loads are instant.
        if (!isEmpty(cwvMobile) || !isEmpty(cwvDesktop)) {
          const newCache = {
            mobile: !isEmpty(cwvMobile) ? cwvMobile : (cache?.mobile ?? null),
            desktop: !isEmpty(cwvDesktop) ? cwvDesktop : (cache?.desktop ?? null),
            fetched_at: new Date().toISOString(),
          }
          const updatedReport = { ...(report ?? {}), cwv_cache: newCache }
          supabase
            .from('client_martech_reports')
            .upsert({
              client_id: params.id,
              completeness: updatedReport,
              created_at: new Date().toISOString(),
            }, { onConflict: 'client_id' })
            .then(({ error }) => {
              if (error) console.warn('[martech:cwv_cache] persist failed:', error.message)
            })
        }
      }
    }
  }

  return NextResponse.json({
    martech: martech || [],
    domain: client.domain,
    completeness: report?.completeness || report, // backwards compat
    maturityScore: report?.maturityScore || null,
    maturityTier: report?.maturityTier || null,
    gapAnalysis: report?.gapAnalysis || [],
    recommendations: report?.recommendations || [],
    cwv: {
      mobile: cwvMobile,
      desktop: cwvDesktop,
      analysis_date: cwvAnalysisDate,
    },
  })
}

// POST /api/clients/[id]/martech — detect/refresh martech stack
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Access enforced by RLS; edit permission is enforced implicitly by the
  // client_members policies on downstream writes (client_martech_reports / client_martech).
  const { data: client } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('id', params.id)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (!client.domain) {
    return NextResponse.json({ error: 'Client has no domain configured' }, { status: 400 })
  }

  try {
    // Co-piloted MarTech agent: detection + quality-judge loop (max 2 retries).
    // The quality judge is sister to the agent — if the output is weak (few
    // tools detected, missing essential categories, contradictory evidence),
    // it returns 'retry' with explicit guidance and the agent re-executes.
    const anthropicKey = process.env.ANTHROPIC_API_KEY || ''
    const outcome = await runAgentWithQuality(
      martechAgent,
      { domain: client.domain },
      { domain: client.domain, anthropicKey },
      { maxRetries: 2, verbose: true },
    )
    const result = outcome.result.output.detection
    const { tools, usage, completeness, maturityScore, maturityTier, gapAnalysis, recommendations } = result

    // Track LLM cost (non-blocking)
    trackLlmUsage({
      userId: user.id,
      clientId: params.id,
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      operation: 'martech_detect_v3',
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      metadata: {
        domain: client.domain,
        tools_detected: tools.length,
        completeness_score: completeness.score,
        completeness_level: completeness.level,
        maturity_score: maturityScore,
        maturity_tier: maturityTier,
        gaps: gapAnalysis.length,
        recommendations: recommendations.length,
        pages_scanned: completeness.pagesScanned,
        agent_attempts: outcome.attempts,
        agent_passed: outcome.passed,
        agent_quality_score: outcome.finalVerdict.score,
      },
    }).catch(() => {})

    // Log activity (non-blocking)
    logActivity({
      userId: user.id,
      action: 'detect_martech',
      resourceType: 'client',
      resourceId: params.id,
      details: {
        domain: client.domain,
        tools_detected: tools.length,
        completeness: completeness.level,
        maturity: `${maturityScore}/100 (${maturityTier})`,
      },
    }).catch(() => {})

    // Delete existing cache for this client
    await supabase
      .from('client_martech')
      .delete()
      .eq('client_id', params.id)

    // Insert new results
    if (tools.length > 0) {
      const rows = tools.map(t => ({
        client_id: params.id,
        category: t.category,
        tool_name: t.tool_name,
        tool_version: t.tool_version,
        confidence: t.confidence,
        details: t.details,
        detected_at: new Date().toISOString(),
      }))

      const { error: insertError } = await supabase
        .from('client_martech')
        .insert(rows)

      if (insertError) {
        console.error('MarTech insert error:', insertError)
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
    }

    // Save full report (completeness + maturity + gaps + recommendations).
    // Embed the agent's quality loop history under `agent_quality` so the
    // UI / debug panel can show why a re-run happened.
    const fullReport = {
      completeness,
      maturityScore,
      maturityTier,
      gapAnalysis,
      recommendations,
      agent_quality: {
        methodology: martechAgent.methodology,
        attempts: outcome.attempts,
        passed: outcome.passed,
        final_score: outcome.finalVerdict.score,
        final_verdict: outcome.finalVerdict.verdict,
        history: outcome.history,
      },
    }

    try {
      await supabase
        .from('client_martech_reports')
        .upsert({
          client_id: params.id,
          completeness: fullReport,
          created_at: new Date().toISOString(),
        }, { onConflict: 'client_id' })
    } catch (reportErr) {
      console.warn('[MarTech] Could not save report:', reportErr)
    }

    // Return fresh data
    const { data: martech } = await supabase
      .from('client_martech')
      .select('*')
      .eq('client_id', params.id)
      .order('category')
      .order('tool_name')

    return NextResponse.json({
      martech: martech || [],
      detected: tools.length,
      domain: client.domain,
      completeness,
      maturityScore,
      maturityTier,
      gapAnalysis,
      recommendations,
      agentQuality: fullReport.agent_quality,
    })
  } catch (err) {
    console.error('MarTech detection error:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Detection failed',
    }, { status: 500 })
  }
}

// Live PSI fetcher used by GET to backfill missing CWV. Mirrors what
// run-analysis.ts does in phase 1, but bounded to a single strategy and
// returns null on any failure (caller is best-effort).
async function fetchLivePsi(
  domain: string,
  apiKey: string,
  strategy: 'mobile' | 'desktop',
): Promise<Record<string, unknown> | null> {
  const url =
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
    `?url=https://${domain}&key=${apiKey}&strategy=${strategy}` +
    `&category=performance&category=accessibility&category=seo&category=best-practices`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      console.warn(`[martech:cwv_live:${strategy}] PSI ${res.status}`)
      return null
    }
    const d = await res.json()
    const cats = d.lighthouseResult?.categories || {}
    return {
      performance_score: Math.round((cats.performance?.score ?? 0) * 100),
      accessibility_score: Math.round((cats.accessibility?.score ?? 0) * 100),
      seo_score: Math.round((cats.seo?.score ?? 0) * 100),
      best_practices_score: Math.round((cats['best-practices']?.score ?? 0) * 100),
    }
  } catch (err) {
    console.warn(`[martech:cwv_live:${strategy}] failed:`, (err as Error).message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

