import { createClient } from '@/lib/supabase/server'
import { anthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'
import { CONTEXTUAL_SYSTEM_PROMPT, ASSISTANT_SYSTEM_PROMPT } from '@/lib/chat/system-prompts'
import { buildClientContext, formatContextForPrompt } from '@/lib/chat/context-builder'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { messages, clientId, conversationId } = body

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Invalid messages format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Build system prompt
    let systemPrompt: string

    if (clientId) {
      // Contextual mode: build client context
      try {
        const ctx = await buildClientContext(clientId, user.id)
        if (ctx) {
          const contextBlock = formatContextForPrompt(ctx)
          systemPrompt = `${CONTEXTUAL_SYSTEM_PROMPT}\n\n---\n\n# CONTESTO CLIENTE\n\n${contextBlock}`
        } else {
          systemPrompt = CONTEXTUAL_SYSTEM_PROMPT
        }
      } catch (ctxErr) {
        console.error('[Ask J API] Context build error:', ctxErr)
        systemPrompt = CONTEXTUAL_SYSTEM_PROMPT
      }
    } else {
      // Assistant mode: no client context
      systemPrompt = ASSISTANT_SYSTEM_PROMPT
    }

    // Stream response from Claude
    const result = streamText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: systemPrompt,
      messages,
      maxTokens: 4096,
      temperature: 0.7,
      async onFinish({ text, usage }) {
        // Track LLM cost (non-blocking)
        trackLlmUsage({
          userId: user.id,
          clientId: clientId || null,
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          operation: 'chat',
          inputTokens: usage.promptTokens || 0,
          outputTokens: usage.completionTokens || 0,
          metadata: { conversationId: conversationId || null },
        }).catch(() => {})

        // Save assistant message to DB if we have a conversation
        if (conversationId && text) {
          try {
            await supabase.from('conversation_messages').insert({
              conversation_id: conversationId,
              role: 'assistant',
              content: text,
            })

            // Update conversation timestamp
            await supabase
              .from('conversations')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', conversationId)
          } catch (err) {
            console.error('[Ask J API] Failed to save assistant message:', err)
          }
        }
      },
    })

    return result.toDataStreamResponse()
  } catch (err) {
    console.error('[Ask J API] Unhandled error:', err)
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal server error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
