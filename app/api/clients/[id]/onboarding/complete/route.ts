// ============================================================
// JBoost — Phase 5D — Onboarding complete endpoint
//
// POST /api/clients/[id]/onboarding/complete
//
// Finalizes the structured onboarding wizard:
//   1. Flips profile.onboarding.status -> 'completed'
//   2. Converts remaining skipped fields into MemoryGap rows
//   3. Kicks off a forced full memory refresh so the newly-saved
//      onboarding seed becomes the first authoritative user_answer
//      source in the memory narrative.
//
// The forced refresh respects the permission check in refreshClientMemory
// and returns any error to the caller so the wizard can show it.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import type { MemoryGap, MemoryProfile } from '@/lib/types/client'
import { buildGapsFromSkippedFields } from '@/lib/onboarding/gap-templates'
import { refreshClientMemory } from '@/lib/memory/refresh'
import { ONBOARDING_VERSION } from '@/lib/onboarding/sections'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(
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

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .single()

    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    // Load current memory (may be empty / brand new).
    const { data: existing } = await supabase
      .from('client_memory')
      .select('profile, gaps')
      .eq('client_id', clientId)
      .maybeSingle()

    const profile: MemoryProfile =
      (existing?.profile as MemoryProfile) || {}
    const existingGaps: MemoryGap[] =
      (existing?.gaps as MemoryGap[]) || []

    const onboarding = profile.onboarding ?? {
      version: ONBOARDING_VERSION,
      status: 'not_started' as const,
      completed_sections: [],
      skipped_fields: [],
    }

    // Build gaps from remaining skipped fields.
    const onboardingGaps = buildGapsFromSkippedFields(
      onboarding.skipped_fields ?? []
    )

    // Merge with existing gaps, preserving any non-onboarding gaps.
    // We deduplicate by question text to avoid re-creating the same gap
    // across multiple complete calls (e.g. if the user completes, then
    // opens the wizard again and completes again).
    const existingNonOnboardingGaps = existingGaps.filter(
      g => !g.id.startsWith('gap_onboarding_')
    )
    const existingQuestions = new Set(existingNonOnboardingGaps.map(g => g.question))
    const mergedGaps: MemoryGap[] = [
      ...existingNonOnboardingGaps,
      ...onboardingGaps.filter(g => !existingQuestions.has(g.question)),
    ]

    // Mark onboarding as completed.
    const nowIso = new Date().toISOString()
    const newOnboarding: MemoryProfile['onboarding'] = {
      ...onboarding,
      version: ONBOARDING_VERSION,
      status: 'completed',
      completed_at: nowIso,
    }

    const updatedProfile: MemoryProfile = {
      ...profile,
      onboarding: newOnboarding,
    }

    const { error: saveError } = await supabase
      .from('client_memory')
      .upsert(
        {
          client_id: clientId,
          profile: updatedProfile as unknown as Record<string, unknown>,
          gaps: mergedGaps as unknown as Record<string, unknown>[],
          updated_at: nowIso,
        },
        { onConflict: 'client_id' }
      )

    if (saveError) {
      return Response.json({ error: saveError.message }, { status: 500 })
    }

    // Trigger a forced full refresh so the synthesizer can build the
    // initial narrative from the new seed. This is best-effort: if it
    // fails (rate limit, LLM error, missing API key), the wizard UI
    // surfaces the warning but the onboarding itself is still marked
    // complete.
    const refreshResult = await refreshClientMemory(
      clientId,
      user.id,
      supabase,
      { force: true }
    )

    return Response.json({
      success: true,
      onboarding: newOnboarding,
      gaps_created: onboardingGaps.length,
      refresh: {
        success: refreshResult.success,
        skipped: refreshResult.skipped ?? false,
        reason: refreshResult.reason,
        error: refreshResult.error,
      },
    })
  } catch (err) {
    console.error('[Onboarding complete] Error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
