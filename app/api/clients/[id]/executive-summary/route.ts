import { createClient } from '@/lib/supabase/server'
import { anthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'
import { EXECUTIVE_SUMMARY_SYSTEM_PROMPT } from '@/lib/chat/system-prompts'
import {
  buildExecutiveSummaryContext,
  formatExecutiveSummaryData,
} from '@/lib/chat/context-builder'
import { NextRequest } from 'next/server'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'
import { logActivity } from '@/lib/tracking/activity'

export const maxDuration = 60

/**
 * GET — Return the latest persisted executive summary for a client.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Access enforced by RLS / client_members.
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .single()

    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    const { data: summary } = await supabase
      .from('executive_summaries')
      .select('id, content, model, generated_at, analysis_id')
      .eq('client_id', clientId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .single()

    return Response.json({ summary: summary || null })
  } catch (err) {
    console.error('[Executive Summary GET] Error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}

/**
 * POST — Generate a new executive summary using Claude, stream it,
 * and persist on completion.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Build comprehensive context
    const ctx = await buildExecutiveSummaryContext(clientId, user.id)

    if (!ctx) {
      return Response.json({ error: 'Cliente non trovato' }, { status: 404 })
    }

    if (!ctx.latestAnalysis) {
      return Response.json(
        { error: 'Nessuna analisi completata per questo cliente. Lancia un\'analisi prima di generare l\'Executive Summary.' },
        { status: 400 }
      )
    }

    // Format data for the prompt
    const dataBlock = formatExecutiveSummaryData(ctx)

    // Stream response from Claude
    const result = streamText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: EXECUTIVE_SUMMARY_SYSTEM_PROMPT,
      prompt: `Analizza i seguenti dati e produci l'Executive Summary:\n\n${dataBlock}`,
      maxTokens: 4096,
      temperature: 0.3,
      async onFinish({ text, usage }) {
        // Track LLM cost (non-blocking)
        trackLlmUsage({
          userId: user.id,
          clientId,
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          operation: 'executive_summary',
          inputTokens: usage.promptTokens || 0,
          outputTokens: usage.completionTokens || 0,
        }).catch(() => {})

        // Log activity (non-blocking)
        logActivity({
          userId: user.id,
          action: 'generate_summary',
          resourceType: 'client',
          resourceId: clientId,
        }).catch(() => {})

        // Persist the generated summary
        if (text) {
          try {
            await supabase.from('executive_summaries').insert({
              client_id: clientId,
              analysis_id: ctx.latestAnalysis!.id,
              content: text,
              model: 'claude-sonnet-4-20250514',
            })
          } catch (err) {
            console.error('[Executive Summary] Failed to persist:', err)
          }
        }
      },
    })

    return result.toDataStreamResponse()
  } catch (err) {
    console.error('[Executive Summary POST] Error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
