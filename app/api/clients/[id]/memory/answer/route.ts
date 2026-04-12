import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { partialRefreshMemory } from '@/lib/memory/refresh'
import type { ClientMemory, MemoryAnswer, MemoryGap } from '@/lib/types/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/clients/[id]/memory/answer
 * Submit an answer to a memory gap question.
 * Saves the answer, removes the gap, triggers a partial refresh.
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
    const body = await req.json()
    const { gap_id, question, answer } = body

    if (!gap_id || !question || !answer) {
      return Response.json(
        { error: 'Missing required fields: gap_id, question, answer' },
        { status: 400 }
      )
    }

    // Load current memory. maybeSingle so a missing row doesn't throw.
    const { data: memoryRow } = await supabase
      .from('client_memory')
      .select('*')
      .eq('client_id', clientId)
      .maybeSingle()

    if (!memoryRow) {
      return Response.json(
        { error: 'Client memory not found. Run a full refresh first.' },
        { status: 404 }
      )
    }

    const memory = memoryRow as unknown as ClientMemory
    const now = new Date().toISOString()

    // 1. Add answer to answers array
    const newAnswer: MemoryAnswer = {
      id: `ans_${Date.now()}`,
      gap_id,
      question,
      answer,
      answered_at: now,
      answered_by: user.id,
    }
    const updatedAnswers = [...memory.answers, newAnswer]

    // 2. Remove the answered gap
    const updatedGaps = (memory.gaps as MemoryGap[]).filter(g => g.id !== gap_id)

    // 3. Save immediately (before partial refresh)
    await supabase
      .from('client_memory')
      .update({
        answers: updatedAnswers as unknown as Record<string, unknown>[],
        gaps: updatedGaps as unknown as Record<string, unknown>[],
        updated_at: now,
      })
      .eq('client_id', clientId)

    // 4. Trigger partial refresh (non-blocking if it fails)
    const updatedMemory = {
      ...memory,
      answers: updatedAnswers,
      gaps: updatedGaps,
    }

    const refreshResult = await partialRefreshMemory(
      clientId,
      user.id,
      supabase,
      question,
      answer,
      updatedMemory
    )

    return Response.json({
      success: true,
      partial_refresh: refreshResult.success,
      answer_id: newAnswer.id,
    })
  } catch (err) {
    console.error('[Memory Answer API] Error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
