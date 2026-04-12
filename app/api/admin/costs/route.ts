import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse period
    const period = req.nextUrl.searchParams.get('period') || '7d'
    let daysAgo = 7
    if (period === 'today') daysAgo = 1
    else if (period === '30d') daysAgo = 30

    const since = new Date()
    since.setDate(since.getDate() - daysAgo)
    const sinceISO = since.toISOString()

    // 1. Totals for period
    const { data: totals } = await supabase
      .from('llm_usage')
      .select('estimated_cost_usd, input_tokens, output_tokens')
      .gte('created_at', sinceISO)

    const totalCost = (totals || []).reduce((sum, r) => sum + Number(r.estimated_cost_usd || 0), 0)
    const totalCalls = (totals || []).length
    const totalInputTokens = (totals || []).reduce((sum, r) => sum + (r.input_tokens || 0), 0)
    const totalOutputTokens = (totals || []).reduce((sum, r) => sum + (r.output_tokens || 0), 0)

    // 2. By user
    const { data: byUserRaw } = await supabase
      .from('llm_usage')
      .select('user_id, estimated_cost_usd, input_tokens, output_tokens')
      .gte('created_at', sinceISO)

    const userMap: Record<string, { cost: number; calls: number; input: number; output: number }> = {}
    for (const r of (byUserRaw || [])) {
      if (!userMap[r.user_id]) userMap[r.user_id] = { cost: 0, calls: 0, input: 0, output: 0 }
      userMap[r.user_id].cost += Number(r.estimated_cost_usd || 0)
      userMap[r.user_id].calls += 1
      userMap[r.user_id].input += r.input_tokens || 0
      userMap[r.user_id].output += r.output_tokens || 0
    }

    // Fetch user names
    const userIds = Object.keys(userMap)
    let userNames: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)
      for (const p of (profiles || [])) {
        userNames[p.id] = p.full_name || 'N/A'
      }
    }

    const byUser = Object.entries(userMap)
      .map(([id, v]) => ({ user_id: id, user_name: userNames[id] || 'N/A', ...v }))
      .sort((a, b) => b.cost - a.cost)

    // 3. By client
    const { data: byClientRaw } = await supabase
      .from('llm_usage')
      .select('client_id, estimated_cost_usd, input_tokens, output_tokens')
      .gte('created_at', sinceISO)
      .not('client_id', 'is', null)

    const clientMap: Record<string, { cost: number; calls: number; input: number; output: number }> = {}
    for (const r of (byClientRaw || [])) {
      const cid = r.client_id || 'unknown'
      if (!clientMap[cid]) clientMap[cid] = { cost: 0, calls: 0, input: 0, output: 0 }
      clientMap[cid].cost += Number(r.estimated_cost_usd || 0)
      clientMap[cid].calls += 1
      clientMap[cid].input += r.input_tokens || 0
      clientMap[cid].output += r.output_tokens || 0
    }

    const clientIds = Object.keys(clientMap)
    let clientNames: Record<string, string> = {}
    if (clientIds.length > 0) {
      const { data: clients } = await supabase
        .from('clients')
        .select('id, name')
        .in('id', clientIds)
      for (const c of (clients || [])) {
        clientNames[c.id] = c.name || 'N/A'
      }
    }

    const byClient = Object.entries(clientMap)
      .map(([id, v]) => ({ client_id: id, client_name: clientNames[id] || 'N/A', ...v }))
      .sort((a, b) => b.cost - a.cost)

    // 4. By operation
    const { data: byOpRaw } = await supabase
      .from('llm_usage')
      .select('operation, estimated_cost_usd, input_tokens, output_tokens')
      .gte('created_at', sinceISO)

    const opMap: Record<string, { cost: number; calls: number; input: number; output: number }> = {}
    for (const r of (byOpRaw || [])) {
      if (!opMap[r.operation]) opMap[r.operation] = { cost: 0, calls: 0, input: 0, output: 0 }
      opMap[r.operation].cost += Number(r.estimated_cost_usd || 0)
      opMap[r.operation].calls += 1
      opMap[r.operation].input += r.input_tokens || 0
      opMap[r.operation].output += r.output_tokens || 0
    }

    const byOperation = Object.entries(opMap)
      .map(([op, v]) => ({ operation: op, ...v }))
      .sort((a, b) => b.cost - a.cost)

    // 5. Recent operations (last 50)
    const { data: recent } = await supabase
      .from('llm_usage')
      .select('id, user_id, client_id, provider, model, operation, input_tokens, output_tokens, estimated_cost_usd, created_at')
      .gte('created_at', sinceISO)
      .order('created_at', { ascending: false })
      .limit(50)

    // Enrich recent with names
    const recentEnriched = (recent || []).map(r => ({
      ...r,
      user_name: userNames[r.user_id] || 'N/A',
      client_name: r.client_id ? (clientNames[r.client_id] || 'N/A') : '—',
    }))

    return NextResponse.json({
      period,
      totals: {
        cost: totalCost,
        calls: totalCalls,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      },
      byUser,
      byClient,
      byOperation,
      recent: recentEnriched,
    })
  } catch (err) {
    console.error('[Admin Costs] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
