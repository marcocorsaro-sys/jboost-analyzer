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
