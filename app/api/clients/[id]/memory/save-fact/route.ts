import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'
import type { ClientMemory, MemoryFact, MemoryFactCategory } from '@/lib/types/client'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES: MemoryFactCategory[] = [
  'seo_performance', 'business', 'technical', 'content',
  'competitor', 'martech', 'contact', 'timeline',
  'budget', 'preference', 'conversation_insight',
]

/**
 * POST /api/clients/[id]/memory/save-fact
 *
 * Conversational save-to-memory entry point (Phase 5C). Lets a user pin a
 * snippet of text from a chat message (or anywhere else in the UI) directly
 * into the client's memory as a new MemoryFact, without having to wait for
 * a full refresh.
 *
 * Body:
 *   {
 *     fact:        string                    (required, max 500 chars)
 *     category:    MemoryFactCategory        (required)
 *     source_id?:  string                    (e.g. conversation_messages.id)
 *     confidence?: number                    (default 0.85)
 *   }
 *
 * The new fact is appended to client_memory.facts immediately. The memory
 * status stays as-is (no full refresh kicked off — that's the user's call).
 * Source is hardcoded to 'conversation' since this endpoint is wired to
 * the chat "Save to memory" button; future callers can extend.
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
    const body = await req.json().catch(() => ({}))

    const fact: string =
      typeof body.fact === 'string' ? body.fact.trim() : ''
    const category: MemoryFactCategory = body.category
    const sourceId: string | null =
      typeof body.source_id === 'string' && body.source_id.length > 0
        ? body.source_id
        : null
    const confidence: number =
      typeof body.confidence === 'number' &&
      body.confidence >= 0 &&
      body.confidence <= 1
        ? body.confidence
        : 0.85

    if (!fact) {
      return Response.json({ error: 'fact is required' }, { status: 400 })
    }
    if (fact.length > 500) {
      return Response.json(
        { error: 'fact must be 500 characters or fewer' },
        { status: 400 }
      )
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return Response.json(
        {
          error: `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
        },
        { status: 400 }
      )
    }

    // RLS on clients enforces multi-tenant access via client_members.
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .single()

    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    // Load (or initialize) the memory row.
    const { data: existing, error: fetchError } = await supabase
      .from('client_memory')
      .select('id, facts')
      .eq('client_id', clientId)
      .maybeSingle()

    if (fetchError) {
      return Response.json({ error: fetchError.message }, { status: 500 })
    }

    const now = new Date().toISOString()
    const newFact: MemoryFact = {
      id: `fact_pinned_${Date.now()}`,
      category,
      fact,
      source: 'conversation',
      source_id: sourceId ?? undefined,
      confidence,
      extracted_at: now,
    }

    if (!existing) {
      // First fact ever pinned for this client — create the row.
      const { error: insertError } = await supabase
        .from('client_memory')
        .upsert(
          {
            client_id: clientId,
            facts: [newFact] as unknown as Record<string, unknown>[],
            status: 'empty',
            completeness: 0,
            updated_at: now,
          },
          { onConflict: 'client_id' }
        )

      if (insertError) {
        return Response.json({ error: insertError.message }, { status: 500 })
      }
    } else {
      const currentFacts =
        ((existing.facts as unknown) as ClientMemory['facts']) ?? []
      const updatedFacts = [...currentFacts, newFact]

      const { error: updateError } = await supabase
        .from('client_memory')
        .update({
          facts: updatedFacts as unknown as Record<string, unknown>[],
          updated_at: now,
        })
        .eq('id', existing.id)

      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 500 })
      }
    }

    logActivity({
      userId: user.id,
      action: 'memory_fact_pinned',
      resourceType: 'client',
      resourceId: clientId,
      details: { category, source_id: sourceId, length: fact.length },
    }).catch(() => {})

    return Response.json({ success: true, fact: newFact })
  } catch (err) {
    console.error('[Memory save-fact] Error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
