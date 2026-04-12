import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/memory-health
 *
 * Admin-only diagnostic endpoint that aggregates the health of every
 * client_memory row across all clients (Phase 5E). Used by the new
 * "Memory Health" tab in /admin to spot:
 *
 *   - clients whose memory has 'failed' (and the error message)
 *   - clients whose memory has been 'stale' for too long
 *   - distribution of completeness percentages
 *   - recent memory_refresh / memory_partial_refresh costs
 *
 * Uses the service-role client to bypass RLS so the admin sees rows
 * across the entire tenant. Caller must be an admin (profiles.role).
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: 'Service role key not configured' },
      { status: 500 }
    )
  }
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  )

  // 1. Read every memory row + the matching client name in a single round-trip.
  const { data: memories, error: memoryError } = await admin
    .from('client_memory')
    .select(
      'client_id, status, completeness, last_refreshed_at, error_message, updated_at, ' +
        'clients ( id, name )'
    )

  if (memoryError) {
    return NextResponse.json(
      {
        error: memoryError.message,
        hint: 'The client_memory table may not exist yet. Apply Phase 5A.',
      },
      { status: 500 }
    )
  }

  type Row = {
    client_id: string
    status: string
    completeness: number
    last_refreshed_at: string | null
    error_message: string | null
    updated_at: string
    clients: { id: string; name: string } | { id: string; name: string }[] | null
  }
  const rows = (memories ?? []) as unknown as Row[]

  // Normalize the joined client (PostgREST returns it as an object or an
  // array depending on the relationship cardinality).
  const normalized = rows.map(r => ({
    client_id: r.client_id,
    client_name: Array.isArray(r.clients)
      ? r.clients[0]?.name ?? null
      : r.clients?.name ?? null,
    status: r.status,
    completeness: r.completeness,
    last_refreshed_at: r.last_refreshed_at,
    error_message: r.error_message,
    updated_at: r.updated_at,
  }))

  const counts: Record<string, number> = {
    empty: 0,
    building: 0,
    refreshing: 0,
    ready: 0,
    stale: 0,
    failed: 0,
  }
  let totalCompleteness = 0
  let countedForAvg = 0
  const failed: typeof normalized = []
  const staleOver7d: typeof normalized = []
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 86400_000

  for (const m of normalized) {
    if (counts[m.status] !== undefined) counts[m.status]++

    if (m.status === 'ready' || m.status === 'stale') {
      totalCompleteness += m.completeness
      countedForAvg++
    }
    if (m.status === 'failed') {
      failed.push(m)
    }
    if (
      m.status === 'stale' &&
      m.last_refreshed_at &&
      new Date(m.last_refreshed_at).getTime() < sevenDaysAgo
    ) {
      staleOver7d.push(m)
    }
  }

  const avgCompleteness = countedForAvg > 0
    ? Math.round(totalCompleteness / countedForAvg)
    : null

  // 2. Recent memory refresh costs (last 30 days).
  const thirtyDaysAgo = new Date(now - 30 * 86400_000).toISOString()
  const { data: usage } = await admin
    .from('llm_usage')
    .select('operation, estimated_cost_usd, input_tokens, output_tokens, created_at')
    .in('operation', ['memory_refresh', 'memory_partial_refresh'])
    .gte('created_at', thirtyDaysAgo)

  const usageRows = usage ?? []
  const totalCostUsd = usageRows.reduce(
    (sum, row) => sum + (row.estimated_cost_usd ?? 0),
    0
  )
  const totalInputTokens = usageRows.reduce(
    (sum, row) => sum + (row.input_tokens ?? 0),
    0
  )
  const totalOutputTokens = usageRows.reduce(
    (sum, row) => sum + (row.output_tokens ?? 0),
    0
  )
  const callsByOperation: Record<string, number> = {}
  for (const row of usageRows) {
    callsByOperation[row.operation] = (callsByOperation[row.operation] ?? 0) + 1
  }

  return NextResponse.json({
    total_memories: normalized.length,
    counts,
    avg_completeness: avgCompleteness,
    failed: failed.slice(0, 50),
    stale_over_7d: staleOver7d.slice(0, 50),
    recent_costs_30d: {
      total_usd: Number(totalCostUsd.toFixed(4)),
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      calls_by_operation: callsByOperation,
    },
  })
}
