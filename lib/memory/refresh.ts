// ============================================================
// JBoost — Client Memory: refresh orchestration
//
// Phase 5A rewrite: fixes the bugs in the original implementation
//   - .single() -> .maybeSingle() so a missing row doesn't throw
//   - atomic upsert instead of insert-then-update dance
//   - source_versions short-circuit (skip refresh if nothing changed)
//   - current_phase progress tracking for the realtime UX layer
//   - facts history archiving on every refresh (Phase 5E groundwork)
//   - clearer error surfacing (status='failed' + error_message visible
//     to the GET endpoint)
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
    'conflict_resolution',
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

// ─── Constants ──────────────────────────────────────────────

/**
 * Soft minimum interval between refreshes triggered by the same client.
 * Used as a safety net only — the real "should I refresh?" decision is
 * source_versions equality (see runFullRefresh below).
 */
const MIN_REFRESH_INTERVAL_MS = 60_000 // 1 minute

// ─── Helpers ────────────────────────────────────────────────

/**
 * Compares two source_versions blobs by JSON equality. Used to short-circuit
 * a refresh when none of the underlying data sources have changed since the
 * last successful run.
 */
function sourceVersionsEqual(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined
): boolean {
  if (!a || !b) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * Update only the lifecycle fields (status / current_phase / error) of an
 * existing memory row. Used during the refresh to give the client realtime
 * progress visibility (Phase 5D will subscribe to these updates).
 */
async function setRefreshPhase(
  supabase: SupabaseClient,
  clientId: string,
  patch: {
    status?: ClientMemory['status']
    current_phase?: string | null
    error_message?: string | null
  }
): Promise<void> {
  await supabase
    .from('client_memory')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
}

/**
 * Archive the facts that are about to be replaced into the
 * client_memory_facts_history table. Append-only audit log. Best-effort:
 * we don't fail the refresh if the history insert fails (it's not critical
 * for runtime correctness, just for the audit trail).
 */
async function archiveFacts(
  supabase: SupabaseClient,
  clientId: string,
  oldFacts: MemoryFact[],
  refreshId: string
): Promise<void> {
  if (oldFacts.length === 0) return
  try {
    const rows = oldFacts.map(f => ({
      client_id: clientId,
      fact_id: f.id,
      fact_data: f as unknown as Record<string, unknown>,
      refresh_id: refreshId,
    }))
    await supabase.from('client_memory_facts_history').insert(rows)
  } catch (err) {
    console.warn('[Memory] facts history archive failed (non-fatal)', err)
  }
}

// ─── Full Memory Refresh ────────────────────────────────────

export interface RefreshOptions {
  /** If true, bypass the source_versions short-circuit and force a fresh LLM call. */
  force?: boolean
}

export interface RefreshResult {
  success: boolean
  /** True if the refresh was skipped because no source changed (and force=false). */
  skipped?: boolean
  /** Human-readable reason when skipped or failed. */
  reason?: string
  error?: string
}

/**
 * Perform a full memory refresh for a client.
 * Gathers ALL data sources, sends to Claude, saves structured memory.
 */
export async function refreshClientMemory(
  clientId: string,
  userId: string,
  supabase: SupabaseClient,
  options: RefreshOptions = {}
): Promise<RefreshResult> {
  const now = new Date().toISOString()
  const refreshId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  // 1. Look up existing memory (if any). maybeSingle so a missing row
  // doesn't throw — we just treat it as a first-time build.
  const { data: existing } = await supabase
    .from('client_memory')
    .select('id, status, last_refreshed_at, source_versions, facts, answers')
    .eq('client_id', clientId)
    .maybeSingle()

  // 2. Soft rate limit: don't allow more than one refresh per minute per
  // client. The real "should I refresh?" check is the source_versions diff
  // below; this is just a guard against accidental rapid clicks.
  if (existing?.last_refreshed_at && !options.force) {
    const elapsed = Date.now() - new Date(existing.last_refreshed_at).getTime()
    if (elapsed < MIN_REFRESH_INTERVAL_MS) {
      return {
        success: false,
        reason: 'rate_limited',
        error: `Refresh troppo frequente. Attendi almeno ${Math.ceil(
          (MIN_REFRESH_INTERVAL_MS - elapsed) / 1000
        )} secondi.`,
      }
    }
  }

  const existingAnswers: MemoryAnswer[] = existing
    ? ((existing.answers as MemoryAnswer[]) || [])
    : []
  const existingFacts: MemoryFact[] = existing
    ? ((existing.facts as MemoryFact[]) || [])
    : []
  const existingSourceVersions: Record<string, unknown> | null = existing
    ? ((existing.source_versions as Record<string, unknown>) || {})
    : null

  // 3. Move into the building/refreshing state immediately so the UI gets
  // realtime feedback. If the row doesn't exist yet, insert a placeholder.
  if (existing) {
    await setRefreshPhase(supabase, clientId, {
      status: 'refreshing',
      current_phase: 'assembling_sources',
      error_message: null,
    })
  } else {
    await supabase.from('client_memory').upsert(
      {
        client_id: clientId,
        status: 'building',
        current_phase: 'assembling_sources',
        error_message: null,
      },
      { onConflict: 'client_id' }
    )
  }

  try {
    // 4. Assemble all data sources.
    const { inputText, sourceVersions } = await assembleClientData(
      clientId,
      supabase,
      existingAnswers
    )

    // 5. Short-circuit: if nothing changed since the last successful run,
    // skip the LLM call and bring the row back to 'ready' without spending
    // tokens. force=true bypasses this.
    if (
      !options.force &&
      existing?.status === 'ready' &&
      sourceVersionsEqual(existingSourceVersions, sourceVersions)
    ) {
      await setRefreshPhase(supabase, clientId, {
        status: 'ready',
        current_phase: null,
        error_message: null,
      })
      return {
        success: true,
        skipped: true,
        reason: 'source_versions unchanged — no LLM call performed',
      }
    }

    console.log(
      `[Memory Refresh] Assembled ${inputText.length} chars for client ${clientId}`
    )

    await setRefreshPhase(supabase, clientId, {
      current_phase: 'synthesizing',
    })

    // 6. Call Claude for memory synthesis.
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-20250514'),
      schema: FullMemorySchema,
      system: MEMORY_SYNTHESIS_SYSTEM_PROMPT,
      prompt: `Analizza i seguenti dati del cliente e genera la memoria strutturata.\n\n${inputText}`,
      temperature: 0.3,
      maxTokens: 8192,
    })

    const memory = result.object

    // Add extracted_at to facts.
    const factsWithDates: MemoryFact[] = memory.facts.map(f => ({
      ...f,
      extracted_at: now,
    }))

    // 7. Archive previous facts before overwriting (best-effort).
    await setRefreshPhase(supabase, clientId, { current_phase: 'saving' })
    await archiveFacts(supabase, clientId, existingFacts, refreshId)

    // 8. Save the full memory atomically with upsert.
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
      current_phase: null,
      error_message: null,
      last_refreshed_at: now,
      updated_at: now,
    }

    const { error: saveError } = await supabase
      .from('client_memory')
      .upsert(upsertData, { onConflict: 'client_id' })

    if (saveError) {
      throw saveError
    }

    // 9. Track LLM usage (non-blocking).
    trackLlmUsage({
      userId,
      clientId,
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      operation: 'memory_refresh',
      inputTokens: result.usage?.promptTokens || 0,
      outputTokens: result.usage?.completionTokens || 0,
      metadata: {
        type: 'full_refresh',
        refresh_id: refreshId,
        facts_archived: existingFacts.length,
        source_versions_changed: !sourceVersionsEqual(
          existingSourceVersions,
          sourceVersions
        ),
      },
    }).catch(() => {})

    console.log(
      `[Memory Refresh] Complete for client ${clientId}: ` +
        `completeness=${memory.completeness}%, ` +
        `facts=${memory.facts.length}, gaps=${memory.gaps.length}`
    )

    return { success: true }
  } catch (err) {
    console.error(`[Memory Refresh] Failed for client ${clientId}:`, err)

    const message = err instanceof Error ? err.message : 'Unknown error'

    // Surface the error to the row so the GET endpoint can show it.
    await setRefreshPhase(supabase, clientId, {
      status: 'failed',
      current_phase: null,
      error_message: message,
    })

    return { success: false, error: message }
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

    // Merge new facts.
    const newFacts: MemoryFact[] = update.new_facts.map(f => ({
      ...f,
      source: 'user_answer' as const,
      extracted_at: now,
    }))
    const mergedFacts = [...currentMemory.facts, ...newFacts]

    // Merge profile updates.
    const mergedProfile = {
      ...currentMemory.profile,
      ...(update.profile_updates as Partial<MemoryProfile>),
    }

    // Add new gaps.
    const mergedGaps = [
      ...currentMemory.gaps,
      ...(update.new_gaps as MemoryGap[]),
    ]

    // Update completeness.
    const newCompleteness = Math.min(
      100,
      Math.max(0, currentMemory.completeness + update.completeness_delta)
    )

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

    // Track usage.
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
    console.error('[Memory Partial Refresh] Failed:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
