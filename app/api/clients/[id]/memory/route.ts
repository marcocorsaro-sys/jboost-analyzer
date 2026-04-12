import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

/**
 * GET /api/clients/[id]/memory
 * Returns the client's memory record.
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

    // Verify client access
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .single()

    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    // Get memory record
    const { data: memory } = await supabase
      .from('client_memory')
      .select('*')
      .eq('client_id', clientId)
      .single()

    if (!memory) {
      // Return empty memory stub
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
