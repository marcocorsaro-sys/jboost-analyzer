import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getSpendStatus } from '@/lib/tracking/spend-limit'
import { estimateCost } from '@/lib/tracking/pricing'

export const dynamic = 'force-dynamic'

interface UsageRow {
  id: string
  user_id: string
  client_id: string | null
  provider: string
  model: string
  operation: string
  input_tokens: number | null
  output_tokens: number | null
  estimated_cost_usd: number | string | null
  created_at: string
}

interface Bucket {
  cost: number
  calls: number
  input: number
  output: number
}

function emptyBucket(): Bucket {
  return { cost: 0, calls: 0, input: 0, output: 0 }
}

/** Resolve the per-row cost — falls back to live pricing when the stored
 *  value is 0 because the model wasn't in the pricing dict at insert time. */
function rowCostUsd(r: UsageRow): number {
  const stored = Number(r.estimated_cost_usd) || 0
  if (stored > 0) return stored
  return estimateCost(r.model ?? '', r.input_tokens ?? 0, r.output_tokens ?? 0)
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const period = req.nextUrl.searchParams.get('period') || '7d'
    let daysAgo = 7
    if (period === 'today') daysAgo = 1
    else if (period === '30d') daysAgo = 30

    const since = new Date()
    since.setDate(since.getDate() - daysAgo)
    const sinceISO = since.toISOString()

    // One single read of the window — aggregate in memory instead of firing
    // four near-identical queries (totals + byUser + byClient + byOperation).
    const { data: rowsRaw, error: usageErr } = await supabase
      .from('llm_usage')
      .select('id, user_id, client_id, provider, model, operation, input_tokens, output_tokens, estimated_cost_usd, created_at')
      .gte('created_at', sinceISO)
      .order('created_at', { ascending: false })
    if (usageErr) {
      return NextResponse.json({ error: usageErr.message }, { status: 500 })
    }
    const rows = (rowsRaw ?? []) as UsageRow[]

    const userBuckets: Record<string, Bucket> = {}
    const clientBuckets: Record<string, Bucket> = {}
    const opBuckets: Record<string, Bucket> = {}
    let totalCost = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0

    for (const r of rows) {
      const cost = rowCostUsd(r)
      const input = r.input_tokens ?? 0
      const output = r.output_tokens ?? 0

      totalCost += cost
      totalInputTokens += input
      totalOutputTokens += output

      if (!userBuckets[r.user_id]) userBuckets[r.user_id] = emptyBucket()
      userBuckets[r.user_id].cost += cost
      userBuckets[r.user_id].calls += 1
      userBuckets[r.user_id].input += input
      userBuckets[r.user_id].output += output

      if (r.client_id) {
        if (!clientBuckets[r.client_id]) clientBuckets[r.client_id] = emptyBucket()
        clientBuckets[r.client_id].cost += cost
        clientBuckets[r.client_id].calls += 1
        clientBuckets[r.client_id].input += input
        clientBuckets[r.client_id].output += output
      }

      if (!opBuckets[r.operation]) opBuckets[r.operation] = emptyBucket()
      opBuckets[r.operation].cost += cost
      opBuckets[r.operation].calls += 1
      opBuckets[r.operation].input += input
      opBuckets[r.operation].output += output
    }

    // Names lookup — only the ids we actually saw, in parallel.
    const userIds = Object.keys(userBuckets)
    const clientIds = Object.keys(clientBuckets)
    const [{ data: profiles }, { data: clients }, spendStatus] = await Promise.all([
      userIds.length > 0
        ? supabase.from('profiles').select('id, full_name').in('id', userIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      clientIds.length > 0
        ? supabase.from('clients').select('id, name').in('id', clientIds)
        : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
      getSpendStatus(supabase),
    ])

    const userNames: Record<string, string> = {}
    for (const p of (profiles ?? [])) userNames[p.id] = p.full_name || 'N/A'
    const clientNames: Record<string, string> = {}
    for (const c of (clients ?? [])) clientNames[c.id] = c.name || 'N/A'

    const byUser = Object.entries(userBuckets)
      .map(([id, v]) => ({ user_id: id, user_name: userNames[id] || 'N/A', ...v }))
      .sort((a, b) => b.cost - a.cost)
    const byClient = Object.entries(clientBuckets)
      .map(([id, v]) => ({ client_id: id, client_name: clientNames[id] || 'N/A', ...v }))
      .sort((a, b) => b.cost - a.cost)
    const byOperation = Object.entries(opBuckets)
      .map(([op, v]) => ({ operation: op, ...v }))
      .sort((a, b) => b.cost - a.cost)

    // Recent = first 50 (already sorted desc).
    const recentEnriched = rows.slice(0, 50).map(r => ({
      ...r,
      estimated_cost_usd: rowCostUsd(r),
      user_name: userNames[r.user_id] || 'N/A',
      client_name: r.client_id ? (clientNames[r.client_id] || 'N/A') : '—',
    }))

    return NextResponse.json({
      period,
      totals: {
        cost: totalCost,
        calls: rows.length,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      },
      byUser,
      byClient,
      byOperation,
      recent: recentEnriched,
      spendStatus,
    })
  } catch (err) {
    console.error('[Admin Costs] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
