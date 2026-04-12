// ============================================================
// JBoost — Client Memory: refresh orchestration
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js'
import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { assembleClientData } from './assembler'
import {
  MEMORY_SYNTHESIS_SYSTEM_PROMPT,
  PARTIAL_REFRESH_SYSTEM_PROMPT,
} from './prompts'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'
import type {
  ClientMemory,
  MemoryFact,
  MemoryGap,
  MemoryProfile,
  MemoryAnswer,
} from '@/lib/types/client'

// ─── Zod schemas for generateObject ─────────────────────────

const FactSchema = z.object({
  id: z.string(),
  category: z.enum([
    'seo_performance', 'business', 'technical', 'content',
    'competitor', 'martech', 'contact', 'timeline',
    'budget', 'preference', 'conversation_insight',
  ]),
  fact: z.string(),
  source: z.enum([
    'analysis', 'knowledge_file', 'conversation',
    'executive_summary', 'martech', 'user_answer', 'company_context',
  ]),
  confidence: z.number().min(0).max(1),
})

const GapSchema = z.object({
  id: z.string(),
  category: z.enum([
    'business', 'team', 'technical', 'goals',
    'budget', 'timeline', 'competitor', 'content_strategy', 'tools',
  ]),
  question: z.string(),
  importance: z.enum(['high', 'medium', 'low']),
  context: z.string(),
})

const ProfileSchema = z.object({
  company_name: z.string().optional(),
  domain: z.string().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
  founded: z.string().optional(),
  headquarters: z.string().optional(),
  key_products_services: z.array(z.string()).optional(),
  target_audience: z.string().optional(),
  geographic_markets: z.array(z.string()).optional(),
  team_contacts: z.array(z.object({
    name: z.string(),
    role: z.string(),
    email: z.string().optional(),
  })).optional(),
  business_goals: z.array(z.string()).optional(),
  budget_info: z.string().optional(),
  challenges: z.array(z.string()).optional(),
  competitors: z.array(z.string()).optional(),
  tools_platforms: z.array(z.string()).optional(),
  engagement: z.object({
    type: z.string().optional(),
    started_at: z.string().optional(),
    contract_type: z.string().optional(),
    services: z.array(z.string()).optional(),
  }).optional(),
  preferences: z.object({
    communication_language: z.string().optional(),
    report_frequency: z.string().optional(),
    preferred_contact: z.string().optional(),
  }).optional(),
})

const FullMemorySchema = z.object({
  profile: ProfileSchema,
  facts: z.array(FactSchema),
  gaps: z.array(GapSchema),
  narrative: z.string(),
  completeness: z.number().min(0).max(100),
})

const PartialRefreshSchema = z.object({
  new_facts: z.array(FactSchema),
  profile_updates: z.record(z.unknown()),
  new_gaps: z.array(GapSchema),
  completeness_delta: z.number(),
})

// ─── Full Memory Refresh ────────────────────────────────────

/**
 * Perform a full memory refresh for a client.
 * Gathers ALL data sources, sends to Claude, saves structured memory.
 */
export async function refreshClientMemory(
  clientId: string,
  userId: string,
  supabase: SupabaseClient
): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString()

  try {
    // 1. Check existing memory and set status
    const { data: existing } = await supabase
      .from('client_memory')
      .select('id, answers, status, last_refreshed_at')
      .eq('client_id', clientId)
      .single()

    // Rate limit: no more than once per 2 minutes
    if (existing?.last_refreshed_at) {
      const elapsed = Date.now() - new Date(existing.last_refreshed_at).getTime()
      if (elapsed < 120_000) {
        return { success: false, error: 'Refresh troppo frequente. Attendi almeno 2 minuti.' }
      }
    }

    const existingAnswers: MemoryAnswer[] = (existing?.answers as MemoryAnswer[]) || []
    const newStatus = existing ? 'refreshing' : 'building'

    if (existing) {
      await supabase
        .from('client_memory')
        .update({ status: newStatus, error_message: null, updated_at: now })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('client_memory')
        .insert({ client_id: clientId, status: newStatus })
    }

    // 2. Assemble all data sources
    const { inputText, sourceVersions } = await assembleClientData(
      clientId,
      supabase,
      existingAnswers
    )

    console.log(`[Memory Refresh] Assembled ${inputText.length} chars for client ${clientId}`)

    // 3. Call Claude for memory synthesis
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-20250514'),
      schema: FullMemorySchema,
      system: MEMORY_SYNTHESIS_SYSTEM_PROMPT,
      prompt: `Analizza i seguenti dati del cliente e genera la memoria strutturata.\n\n${inputText}`,
      temperature: 0.3,
      maxTokens: 8192,
    })

    const memory = result.object

    // Add extracted_at to facts
    const factsWithDates: MemoryFact[] = memory.facts.map(f => ({
      ...f,
      extracted_at: now,
    }))

    // 4. Save to DB (upsert)
    const upsertData = {
      client_id: clientId,
      profile: memory.profile as unknown as Record<string, unknown>,
      facts: factsWithDates as unknown as Record<string, unknown>[],
      gaps: memory.gaps as unknown as Record<string, unknown>[],
      narrative: memory.narrative,
      answers: existingAnswers as unknown as Record<string, unknown>[],
      status: 'ready' as const,
      completeness: Math.round(memory.completeness),
      source_versions: sourceVersions,
      error_message: null,
      last_refreshed_at: now,
      updated_at: now,
    }

    if (existing) {
      await supabase
        .from('client_memory')
        .update(upsertData)
        .eq('id', existing.id)
    } else {
      await supabase
        .from('client_memory')
        .update(upsertData)
        .eq('client_id', clientId)
    }

    // 5. Track LLM usage (non-blocking)
    trackLlmUsage({
      userId,
      clientId,
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      operation: 'memory_refresh',
      inputTokens: result.usage?.promptTokens || 0,
      outputTokens: result.usage?.completionTokens || 0,
      metadata: { type: 'full_refresh' },
    }).catch(() => {})

    console.log(`[Memory Refresh] Complete for client ${clientId}: completeness=${memory.completeness}%, facts=${memory.facts.length}, gaps=${memory.gaps.length}`)

    return { success: true }
  } catch (err) {
    console.error(`[Memory Refresh] Failed for client ${clientId}:`, err)

    // Mark as failed
    await supabase
      .from('client_memory')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        updated_at: now,
      })
      .eq('client_id', clientId)

    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ─── Partial Refresh (after gap answer) ─────────────────────

/**
 * Perform a lightweight partial refresh after a user answers a gap question.
 * Only processes the new answer, not all sources.
 */
export async function partialRefreshMemory(
  clientId: string,
  userId: string,
  supabase: SupabaseClient,
  question: string,
  answer: string,
  currentMemory: ClientMemory
): Promise<{ success: boolean; error?: string }> {
  try {
    const profileSummary = JSON.stringify({
      company_name: currentMemory.profile.company_name,
      domain: currentMemory.profile.domain,
      industry: currentMemory.profile.industry,
      business_goals: currentMemory.profile.business_goals,
    })

    const result = await generateObject({
      model: anthropic('claude-sonnet-4-20250514'),
      schema: PartialRefreshSchema,
      system: PARTIAL_REFRESH_SYSTEM_PROMPT,
      prompt: `Profilo attuale del cliente (sintesi): ${profileSummary}\n\nDomanda: ${question}\nRisposta dell'utente: ${answer}\n\nEstrai fatti, suggerisci aggiornamenti al profilo, e identifica nuovi gap.`,
      temperature: 0.2,
      maxTokens: 2048,
    })

    const update = result.object
    const now = new Date().toISOString()

    // Merge new facts
    const newFacts: MemoryFact[] = update.new_facts.map(f => ({
      ...f,
      source: 'user_answer' as const,
      extracted_at: now,
    }))
    const mergedFacts = [...currentMemory.facts, ...newFacts]

    // Merge profile updates
    const mergedProfile = {
      ...currentMemory.profile,
      ...(update.profile_updates as Partial<MemoryProfile>),
    }

    // Add new gaps
    const mergedGaps = [...currentMemory.gaps, ...update.new_gaps as MemoryGap[]]

    // Update completeness
    const newCompleteness = Math.min(100, Math.max(0,
      currentMemory.completeness + update.completeness_delta
    ))

    await supabase
      .from('client_memory')
      .update({
        profile: mergedProfile as unknown as Record<string, unknown>,
        facts: mergedFacts as unknown as Record<string, unknown>[],
        gaps: mergedGaps as unknown as Record<string, unknown>[],
        completeness: newCompleteness,
        updated_at: now,
      })
      .eq('client_id', clientId)

    // Track usage
    trackLlmUsage({
      userId,
      clientId,
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      operation: 'memory_partial_refresh',
      inputTokens: result.usage?.promptTokens || 0,
      outputTokens: result.usage?.completionTokens || 0,
      metadata: { type: 'partial_refresh', question },
    }).catch(() => {})

    return { success: true }
  } catch (err) {
    console.error(`[Memory Partial Refresh] Failed:`, err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
