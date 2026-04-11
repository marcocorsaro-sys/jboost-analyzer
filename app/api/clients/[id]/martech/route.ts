import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { detectMartechStack } from '@/lib/martech/detect'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'
import { logActivity } from '@/lib/tracking/activity'

export const maxDuration = 60

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

  // Verify client ownership
  const { data: client } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('id', params.id)
    .eq('user_id', user.id)
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

  return NextResponse.json({ martech: martech || [], domain: client.domain })
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

  // Verify client ownership and get domain
  const { data: client } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (!client.domain) {
    return NextResponse.json({ error: 'Client has no domain configured' }, { status: 400 })
  }

  try {
    // Run detection (returns { tools, usage })
    const { tools, usage } = await detectMartechStack(client.domain)

    // Track LLM cost (non-blocking)
    trackLlmUsage({
      userId: user.id,
      clientId: params.id,
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      operation: 'martech_detect',
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      metadata: { domain: client.domain, tools_detected: tools.length },
    }).catch(() => {})

    // Log activity (non-blocking)
    logActivity({
      userId: user.id,
      action: 'detect_martech',
      resourceType: 'client',
      resourceId: params.id,
      details: { domain: client.domain, tools_detected: tools.length },
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
    })
  } catch (err) {
    console.error('MarTech detection error:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Detection failed',
    }, { status: 500 })
  }
}
