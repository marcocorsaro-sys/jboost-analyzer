// ============================================================
// JBoost — Client Memory: refresh orchestration
//
// Phase 5A original + Phase 5C-hotfix robustness pass.
//
// Critical changes vs. the previous revision:
//
//   1. setRefreshPhase() now uses UPSERT (not UPDATE), so it ALWAYS
//      persists the row even if the placeholder hasn't been created yet.
//      Previously, when the refresh failed before the placeholder insert
//      succeeded, the catch block would call setRefreshPhase('failed')
//      which silently no-op'd because there was no row to update — and
//      the user would see "Not initialized" forever.
//
//   2. The initial placeholder UPSERT is now error-checked. If RLS rejects
//      it (most commonly because the caller isn't in client_members for
//      this client), we return immediately with a clear error message
//      INSTEAD of proceeding through the assembler + LLM call (which
//      would waste tokens and then fail the save anyway).
//
//   3. Every step now logs its outcome with a [Memory] prefix so Vercel
//      function logs make root-causing trivial: assembling, synthesizing,
//      saving, success / failed at each stage with the relevant details.
//
//   4. The final save error is also surfaced via setRefreshPhase, which
//      now actually persists thanks to (1).
//
// This file is paired with:
//   - lib/memory/assembler.ts   (sectional try/catch around every source)
//   - migration phase5b_memory_robustness.sql (placeholder backfill +
//     orphan-client owner fallback so the RLS path always succeeds)
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

const MIN_REFRESH_INTERVAL_MS = 60_000 // 1 minute soft rate limit

const log = {
  info: (clientId: string, msg: string, extra?: Record<string, unknown>) =>
    console.log(`[Memory ✓] ${clientId} ${msg}`, extra ?? ''),
  warn: (clientId: string, msg: string, extra?: Record<string, unknown>) =>
    console.warn(`[Memory ⚠] ${clientId} ${msg}`, extra ?? ''),
  error: (clientId: string, msg: string, extra?: unknown) =>
    console.error(`[Memory ✗] ${clientId} ${msg}`, extra ?? ''),
}

// ─── Helpers ────────────────────────────────────────────────

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
 * Persist a status / phase / error update for a client_memory row.
 *
 * IMPORTANT: this MUST be an UPSERT, not an UPDATE. The previous version
 * used UPDATE, which silently no-op'd when the row didn't exist yet —
 * meaning the catch handler at the end of refreshClientMemory could never
 * actually persist a 'failed' status for a client whose memory had never
 * been built before. Result: the user saw "Not initialized" instead of the
 * real error.
 */
async function setRefreshPhase(
  supabase: SupabaseClient,
  clientId: string,
  patch: {
    status?: ClientMemory['status']
    current_phase?: string | null
    error_message?: string | null
  }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('client_memory')
    .upsert(
      { client_id: clientId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'client_id' }
    )
  if (error) {
    log.error(clientId, `setRefreshPhase failed: ${error.message}`, {
      patch,
      error,
    })
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

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
    const { error } = await supabase
      .from('client_memory_facts_history')
      .insert(rows)
    if (error) {
      log.warn(clientId, `facts history archive failed (non-fatal)`, {
        count: rows.length,
        error: error.message,
      })
    }
  } catch (err) {
    log.warn(clientId, `facts history archive threw (non-fatal)`, { err })
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
 *
 * Returns a structured result so the caller can distinguish skipped (200),
 * rate_limited (429), permission_denied (403), and failed (500).
 */
export async function refreshClientMemory(
  clientId: string,
  userId: string,
  supabase: SupabaseClient,
  options: RefreshOptions = {}
): Promise<RefreshResult> {
  const startedAt = Date.now()
  const now = new Date().toISOString()
  const refreshId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  log.info(clientId, `refresh started`, { refreshId, force: options.force })

  // ─── 1. Look up existing memory (if any) ─────────────────────────────
  const { data: existing, error: lookupError } = await supabase
    .from('client_memory')
    .select('id, status, last_refreshed_at, source_versions, facts, answers')
    .eq('client_id', clientId)
    .maybeSingle()

  if (lookupError) {
    log.error(clientId, `lookup failed: ${lookupError.message}`, lookupError)
    return {
      success: false,
      reason: 'lookup_failed',
      error:
        `Failed to read client_memory row: ${lookupError.message}. ` +
        `Most likely the Phase 5A migration (client_memory table) hasn't ` +
        `been applied to this database. Apply _phase4_plus_5_combined.sql.`,
    }
  }

  // ─── 2. Soft rate limit ──────────────────────────────────────────────
  if (existing?.last_refreshed_at && !options.force) {
    const elapsed = Date.now() - new Date(existing.last_refreshed_at).getTime()
    if (elapsed < MIN_REFRESH_INTERVAL_MS) {
      log.info(clientId, `rate limited`, { elapsed_ms: elapsed })
      return {
        success: false,
        reason: 'rate_limited',
        error: `Refresh troppo frequente. Attendi almeno ${Math.ceil(
          (MIN_REFRESH_INTERVAL_MS - elapsed) / 1000
        )} secondi.`,
      }
    }
  }

  const existingAnswers: MemoryAnswer[] =
    (existing?.answers as MemoryAnswer[]) || []
  const existingFacts: MemoryFact[] =
    (existing?.facts as MemoryFact[]) || []
  const existingSourceVersions: Record<string, unknown> | null = existing
    ? ((existing.source_versions as Record<string, unknown>) || {})
    : null

  // ─── 3. Move into building/refreshing state immediately ──────────────
  // Critical: if this fails (most commonly because the caller doesn't have
  // edit permission via client_members), we ABORT here with a clear error.
  // Previously this UPSERT was unchecked, so the flow continued, paid for
  // a Claude call, and then failed the save anyway with no visible error.
  const transitioning: ClientMemory['status'] = existing ? 'refreshing' : 'building'
  const phaseResult = await setRefreshPhase(supabase, clientId, {
    status: transitioning,
    current_phase: 'assembling_sources',
    error_message: null,
  })
  if (!phaseResult.ok) {
    const msg =
      phaseResult.error?.includes('row-level security') ||
      phaseResult.error?.toLowerCase().includes('permission')
        ? `Permission denied. Your user does not have editor access on this client. ` +
          `Check that you're listed in client_members with role owner or editor, ` +
          `or that you're a global admin in profiles.role.`
        : `Could not initialize memory row: ${phaseResult.error}`
    log.error(clientId, `placeholder upsert failed — aborting`, phaseResult)
    return { success: false, reason: 'permission_denied', error: msg }
  }
  log.info(clientId, `placeholder set, status=${transitioning}`)

  try {
    // ─── 4. Assemble all data sources ──────────────────────────────────
    const assembled = await assembleClientData(clientId, supabase, existingAnswers)
    log.info(clientId, `assembled sources`, {
      chars: assembled.inputText.length,
      sources: Object.keys(assembled.sourceVersions),
    })

    // ─── 5. source_versions short-circuit ──────────────────────────────
    if (
      !options.force &&
      existing?.status === 'ready' &&
      sourceVersionsEqual(existingSourceVersions, assembled.sourceVersions)
    ) {
      log.info(clientId, `skipped (no source changes)`)
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

    // ─── 6. Call Claude for memory synthesis ───────────────────────────
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        `ANTHROPIC_API_KEY is not set in the server environment. ` +
        `Set it on Vercel under Project Settings → Environment Variables.`
      )
    }

    await setRefreshPhase(supabase, clientId, { current_phase: 'synthesizing' })
    log.info(clientId, `calling Claude (sonnet-4)`)

    const result = await generateObject({
      model: anthropic('claude-sonnet-4-20250514'),
      schema: FullMemorySchema,
      system: MEMORY_SYNTHESIS_SYSTEM_PROMPT,
      prompt: `Analizza i seguenti dati del cliente e genera la memoria strutturata.\n\n${assembled.inputText}`,
      temperature: 0.3,
      maxTokens: 8192,
    })

    const memory = result.object
    log.info(clientId, `Claude returned`, {
      facts: memory.facts.length,
      gaps: memory.gaps.length,
      completeness: memory.completeness,
      input_tokens: result.usage?.promptTokens,
      output_tokens: result.usage?.completionTokens,
    })

    const factsWithDates: MemoryFact[] = memory.facts.map(f => ({
      ...f,
      extracted_at: now,
    }))

    // ─── 7. Archive previous facts (best-effort) ───────────────────────
    await setRefreshPhase(supabase, clientId, { current_phase: 'saving' })
    await archiveFacts(supabase, clientId, existingFacts, refreshId)

    // ─── 8. Save the full memory ───────────────────────────────────────
    const upsertData = {
      client_id: clientId,
      profile: memory.profile as unknown as Record<string, unknown>,
      facts: factsWithDates as unknown as Record<string, unknown>[],
      gaps: memory.gaps as unknown as Record<string, unknown>[],
      narrative: memory.narrative,
      answers: existingAnswers as unknown as Record<string, unknown>[],
      status: 'ready' as const,
      completeness: Math.round(memory.completeness),
      source_versions: assembled.sourceVersions,
      current_phase: null,
      error_message: null,
      last_refreshed_at: now,
      updated_at: now,
    }

    const { error: saveError } = await supabase
      .from('client_memory')
      .upsert(upsertData, { onConflict: 'client_id' })

    if (saveError) {
      throw new Error(`save failed: ${saveError.message}`)
    }

    // ─── 9. Track LLM usage (non-blocking) ─────────────────────────────
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
          assembled.sourceVersions
        ),
        duration_ms: Date.now() - startedAt,
      },
    }).catch(() => {})

    log.info(clientId, `refresh complete`, {
      duration_ms: Date.now() - startedAt,
      completeness: memory.completeness,
    })

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    log.error(clientId, `refresh failed`, { message, err })

    // Surface the error to the row so the GET endpoint can show it.
    // Now uses upsert (via setRefreshPhase) so it persists even if the
    // placeholder insert had failed.
    await setRefreshPhase(supabase, clientId, {
      status: 'failed',
      current_phase: null,
      error_message: message,
    })

    return { success: false, error: message }
  }
}

// ─── Partial Refresh (after gap answer) ─────────────────────

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

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set in the server environment.')
    }

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

    const newFacts: MemoryFact[] = update.new_facts.map(f => ({
      ...f,
      source: 'user_answer' as const,
      extracted_at: now,
    }))
    const mergedFacts = [...currentMemory.facts, ...newFacts]

    const mergedProfile = {
      ...currentMemory.profile,
      ...(update.profile_updates as Partial<MemoryProfile>),
    }

    const mergedGaps = [
      ...currentMemory.gaps,
      ...(update.new_gaps as MemoryGap[]),
    ]

    const newCompleteness = Math.min(
      100,
      Math.max(0, currentMemory.completeness + update.completeness_delta)
    )

    const { error: updateError } = await supabase
      .from('client_memory')
      .update({
        profile: mergedProfile as unknown as Record<string, unknown>,
        facts: mergedFacts as unknown as Record<string, unknown>[],
        gaps: mergedGaps as unknown as Record<string, unknown>[],
        completeness: newCompleteness,
        updated_at: now,
      })
      .eq('client_id', clientId)

    if (updateError) {
      throw new Error(`partial save failed: ${updateError.message}`)
    }

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
    log.error(clientId, `partial refresh failed`, err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
