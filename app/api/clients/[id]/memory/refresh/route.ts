import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { refreshClientMemory } from '@/lib/memory/refresh'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/clients/[id]/memory/refresh
 *
 * Triggers a full memory refresh. Reuses runFullRefresh from lib/memory.
 * Optional query param `?force=true` bypasses the source_versions
 * short-circuit and the rate limit (use sparingly — it pays full LLM cost).
 *
 * Returns:
 *   { success: true }                                 -> refresh ran
 *   { success: true, skipped: true, reason }          -> nothing changed
 *   { error: "..." }              4xx/5xx             -> failed
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const clientId = params.id
    const force = new URL(req.url).searchParams.get('force') === 'true'

    // RLS on clients enforces multi-tenant access via client_members.
    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', clientId)
      .single()

    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    console.log(
      `[Memory Refresh] Starting for client ${client.name} (${clientId})` +
        (force ? ' [FORCE]' : '')
    )

    const result = await refreshClientMemory(clientId, user.id, supabase, {
      force,
    })

    if (result.success) {
      return Response.json({
        success: true,
        skipped: result.skipped ?? false,
        reason: result.reason,
      })
    }

    // Distinguish rate limit (429) from a real failure (500).
    const status = result.reason === 'rate_limited' ? 429 : 500
    return Response.json(
      { error: result.error || 'Refresh failed', reason: result.reason },
      { status }
    )
  } catch (err) {
    console.error('[Memory Refresh API] Error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
