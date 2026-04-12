import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/clients/[id]/memory
 *
 * Returns the client's memory record. If the client has no memory row yet
 * (i.e. nobody has ever clicked refresh) we return an explicit empty stub
 * with `status: 'empty'` so the UI can render the "Build memory now"
 * empty state instead of showing an error.
 *
 * If a real row exists with `status='failed'` we DO return that row — the
 * UI needs `error_message` to display the failure reason.
 */
export async function GET(
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

    // RLS on the clients table enforces access via client_members.
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .single()

    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    // maybeSingle so a missing row resolves to null instead of throwing.
    const { data: memory, error: memoryError } = await supabase
      .from('client_memory')
      .select('*')
      .eq('client_id', clientId)
      .maybeSingle()

    if (memoryError) {
      // The table itself might not exist (Phase 5A migration not applied
      // on this environment). Surface the actual reason instead of an
      // empty stub so the user knows what to do.
      console.error('[Memory GET] DB error:', memoryError)
      return Response.json(
        {
          error: memoryError.message,
          hint: 'The client_memory table may not exist yet. Apply the Phase 5A migration.',
        },
        { status: 500 }
      )
    }

    if (!memory) {
      // Empty stub for first-time clients.
      return Response.json({
        memory: {
          client_id: clientId,
          profile: {},
          facts: [],
          gaps: [],
          narrative: null,
          answers: [],
          status: 'empty',
          completeness: 0,
          source_versions: {},
          current_phase: null,
          error_message: null,
          last_refreshed_at: null,
        },
      })
    }

    return Response.json({ memory })
  } catch (err) {
    console.error('[Memory GET] Error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
