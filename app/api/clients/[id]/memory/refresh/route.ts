import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { refreshClientMemory } from '@/lib/memory/refresh'

export const maxDuration = 120

/**
 * POST /api/clients/[id]/memory/refresh
 * Triggers a full memory refresh for the client.
 * Gathers all data sources and synthesizes a structured memory via Claude.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const clientId = params.id

    // Verify client access
    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', clientId)
      .single()

    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    console.log(`[Memory Refresh] Starting for client ${client.name} (${clientId})`)

    const result = await refreshClientMemory(clientId, user.id, supabase)

    if (result.success) {
      return Response.json({ success: true })
    } else {
      return Response.json(
        { error: result.error || 'Refresh failed' },
        { status: 500 }
      )
    }
  } catch (err) {
    console.error('[Memory Refresh API] Error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
