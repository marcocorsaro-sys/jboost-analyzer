import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { detectMartechStack } from '@/lib/martech/detect'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'
import { logActivity } from '@/lib/tracking/activity'

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

  return NextResponse.json({
    martech: martech || [],
    domain: client.domain,
    completeness: report?.completeness || report, // backwards compat
    maturityScore: report?.maturityScore || null,
    maturityTier: report?.maturityTier || null,
    gapAnalysis: report?.gapAnalysis || [],
    recommendations: report?.recommendations || [],
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
    // Run V3 detection (pattern matching + web search + AI analysis)
    const result = await detectMartechStack(client.domain)
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

    // Save full report (completeness + maturity + gaps + recommendations)
    const fullReport = {
      completeness,
      maturityScore,
      maturityTier,
      gapAnalysis,
      recommendations,
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
    })
  } catch (err) {
    console.error('MarTech detection error:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Detection failed',
    }, { status: 500 })
  }
}
