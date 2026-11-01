/**
 * MCP connector — usage log (Settings > "Connettore Claude").
 * Service-role only: the table has RLS enabled and no policies.
 */

import type { ToolCallRecord } from './jsonrpc'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function recordToolCall(
  principal: { userId: string; email: string | null; clientId: string | null },
  record: ToolCallRecord,
): Promise<void> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    await createAdminClient().from('mcp_tool_calls').insert({
      user_id: principal.userId,
      email: principal.email,
      tool: record.tool,
      analysis_id: record.analysisId && UUID_RE.test(record.analysisId) ? record.analysisId : null,
      ok: record.ok,
      error: record.error,
      client_id: principal.clientId,
      duration_ms: record.durationMs,
    })
  } catch {
    // best effort
  }
}

export interface McpUsageSummary {
  windowDays: number
  totalCalls: number
  people: number
  lastCallAt: string | null
  perPerson: Array<{ email: string | null; calls: number; lastCallAt: string }>
}

export const USAGE_WINDOW_DAYS = 30

/** Aggregate of the last 30 days (computed in JS: volumes are tiny). */
export function summarizeUsage(
  rows: Array<{ user_id: string; email: string | null; created_at: string }>,
  windowDays = USAGE_WINDOW_DAYS,
): McpUsageSummary {
  const per = new Map<string, { email: string | null; calls: number; lastCallAt: string }>()
  let last: string | null = null
  for (const r of rows) {
    const cur = per.get(r.user_id) ?? { email: r.email, calls: 0, lastCallAt: r.created_at }
    cur.calls += 1
    if (r.created_at > cur.lastCallAt) cur.lastCallAt = r.created_at
    if (!cur.email && r.email) cur.email = r.email
    per.set(r.user_id, cur)
    if (!last || r.created_at > last) last = r.created_at
  }
  return {
    windowDays,
    totalCalls: rows.length,
    people: per.size,
    lastCallAt: last,
    perPerson: [...per.values()].sort((a, b) => b.calls - a.calls),
  }
}

export async function getUsageSummary(): Promise<McpUsageSummary> {
  const since = new Date(Date.now() - USAGE_WINDOW_DAYS * 86_400_000).toISOString()
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { data } = await createAdminClient()
      .from('mcp_tool_calls')
      .select('user_id, email, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20000)
    return summarizeUsage((data ?? []) as Array<{ user_id: string; email: string | null; created_at: string }>)
  } catch {
    return summarizeUsage([])
  }
}
