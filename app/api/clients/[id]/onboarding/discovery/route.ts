// ============================================================
// JBoost — Phase 5D — Onboarding discovery chat endpoint
//
// POST /api/clients/[id]/onboarding/discovery
//
// Streaming chat that runs AFTER the structured wizard. Claude
// plays the role of a senior discovery interviewer, asks the
// consultant open-ended questions, and pins atomic insights to
// `client_memory.facts` via a `save_fact` tool call.
//
// Body:
//   { messages: CoreMessage[], end?: boolean }
//
// Sets `profile.onboarding.discovery_chat_completed = true` when
// the caller passes `end: true`.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { anthropic } from '@ai-sdk/anthropic'
import { streamText, tool } from 'ai'
import { z } from 'zod'
import type { MemoryFact, MemoryFactCategory, MemoryProfile } from '@/lib/types/client'
import { DISCOVERY_CHAT_SYSTEM_PROMPT } from '@/lib/onboarding/prompts'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'

export const maxDuration = 60

const VALID_CATEGORIES: MemoryFactCategory[] = [
  'seo_performance', 'business', 'technical', 'content',
  'competitor', 'martech', 'contact', 'timeline',
  'budget', 'preference', 'conversation_insight',
]

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const clientId = params.id
    const body = await req.json().catch(() => ({}))
    const messages = Array.isArray(body.messages) ? body.messages : []
    const end: boolean = body.end === true

    // Handle "end of discovery" signal — flip the flag and return.
    if (end) {
      const { data: existing } = await supabase
        .from('client_memory')
        .select('profile')
        .eq('client_id', clientId)
        .maybeSingle()

      const profile: MemoryProfile =
        (existing?.profile as MemoryProfile) || {}
      const updatedProfile: MemoryProfile = {
        ...profile,
        onboarding: {
          version: profile.onboarding?.version ?? 1,
          status: profile.onboarding?.status ?? 'in_progress',
          completed_sections: profile.onboarding?.completed_sections ?? [],
          skipped_fields: profile.onboarding?.skipped_fields ?? [],
          last_section: profile.onboarding?.last_section,
          started_at: profile.onboarding?.started_at,
          completed_at: profile.onboarding?.completed_at,
          discovery_chat_completed: true,
        },
      }

      await supabase
        .from('client_memory')
        .upsert(
          {
            client_id: clientId,
            profile: updatedProfile as unknown as Record<string, unknown>,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'client_id' }
        )

      return new Response(
        JSON.stringify({ success: true, discovery_chat_completed: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Stream the discovery chat with the save_fact tool.
    const result = streamText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: DISCOVERY_CHAT_SYSTEM_PROMPT,
      messages,
      maxTokens: 1500,
      temperature: 0.7,
      tools: {
        save_fact: tool({
          description:
            'Pin an atomic factual insight about the client to their permanent memory. Use only when the consultant has stated something concrete and actionable.',
          parameters: z.object({
            fact: z.string().max(300)
              .describe('Single-sentence atomic fact about the client (Italian, max 200 chars).'),
            category: z.enum([
              'seo_performance', 'business', 'technical', 'content',
              'competitor', 'martech', 'contact', 'timeline',
              'budget', 'preference', 'conversation_insight',
            ]).describe('Memory fact category.'),
            confidence: z.number().min(0).max(1).default(0.9)
              .describe('Confidence score 0-1. Use 0.85-0.95 for direct consultant statements.'),
          }),
          execute: async ({ fact, category, confidence }) => {
            if (!VALID_CATEGORIES.includes(category as MemoryFactCategory)) {
              return { success: false, error: `Invalid category: ${category}` }
            }
            const trimmed = fact.trim()
            if (!trimmed) {
              return { success: false, error: 'Empty fact' }
            }

            const newFact: MemoryFact = {
              id: `fact_discovery_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
              category: category as MemoryFactCategory,
              fact: trimmed.slice(0, 500),
              source: 'conversation',
              confidence,
              extracted_at: new Date().toISOString(),
            }

            try {
              const { data: row } = await supabase
                .from('client_memory')
                .select('id, facts')
                .eq('client_id', clientId)
                .maybeSingle()

              if (!row) {
                const { error } = await supabase
                  .from('client_memory')
                  .upsert(
                    {
                      client_id: clientId,
                      facts: [newFact] as unknown as Record<string, unknown>[],
                      status: 'empty',
                      completeness: 0,
                      updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'client_id' }
                  )
                if (error) return { success: false, error: error.message }
              } else {
                const existingFacts =
                  ((row.facts as unknown) as MemoryFact[]) || []
                const { error } = await supabase
                  .from('client_memory')
                  .update({
                    facts: [...existingFacts, newFact] as unknown as Record<string, unknown>[],
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', row.id)
                if (error) return { success: false, error: error.message }
              }

              return { success: true, fact_id: newFact.id }
            } catch (e) {
              return {
                success: false,
                error: e instanceof Error ? e.message : 'unknown',
              }
            }
          },
        }),
      },
      async onFinish({ usage }) {
        trackLlmUsage({
          userId: user.id,
          clientId,
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          operation: 'onboarding_discovery',
          inputTokens: usage.promptTokens || 0,
          outputTokens: usage.completionTokens || 0,
          metadata: { phase: 'discovery_chat' },
        }).catch(() => {})
      },
    })

    return result.toDataStreamResponse()
  } catch (err) {
    console.error('[Onboarding discovery] Error:', err)
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal server error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
