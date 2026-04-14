// ============================================================
// JBoost — Phase 5D — Onboarding API (GET + PATCH)
//
// GET    /api/clients/[id]/onboarding
//   Hydrate the wizard: returns the relevant `profile` sections plus
//   the `profile.onboarding` state so the UI can resume from where
//   the user left off.
//
// PATCH  /api/clients/[id]/onboarding
//   Partial save. Body shape:
//     {
//       section_id: string,               // the wizard section id
//       values: Record<string, unknown>,  // dotted-path updates to profile
//       skipped_fields?: string[],        // newly skipped field paths
//       mark_section_complete?: boolean,  // push section_id onto completed_sections
//     }
//   Does a JSONB deep-merge on client_memory.profile via upsert.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import type { ClientMemory, MemoryProfile } from '@/lib/types/client'
import {
  ALL_ONBOARDING_FIELD_PATHS,
  ONBOARDING_SECTIONS,
  ONBOARDING_VERSION,
  findSectionById,
} from '@/lib/onboarding/sections'

export const dynamic = 'force-dynamic'

// ─── Helpers ──────────────────────────────────────────────────

/** Deep-set a dotted path on a plain object, creating intermediates. */
function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.')
  let cursor: Record<string, unknown> = obj
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i]
    if (typeof cursor[k] !== 'object' || cursor[k] === null || Array.isArray(cursor[k])) {
      cursor[k] = {}
    }
    cursor = cursor[k] as Record<string, unknown>
  }
  cursor[segments[segments.length - 1]] = value
}

/** Deep-get a dotted path. Returns undefined if the path doesn't resolve. */
function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.')
  let cursor: unknown = obj
  for (const seg of segments) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[seg]
  }
  return cursor
}

/** Is this value "empty" for the purpose of wizard display? */
function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length === 0
  return false
}

// ─── GET ──────────────────────────────────────────────────────
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

    // RLS on clients enforces multi-tenant access.
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, domain, industry')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    const { data: memory } = await supabase
      .from('client_memory')
      .select('profile, completeness')
      .eq('client_id', clientId)
      .maybeSingle()

    const profile: MemoryProfile =
      (memory?.profile as MemoryProfile | null) || {}

    // Default onboarding state for brand-new clients.
    const onboarding = profile.onboarding ?? {
      version: ONBOARDING_VERSION,
      status: 'not_started' as const,
      completed_sections: [],
      skipped_fields: [],
    }

    return Response.json({
      client: {
        id: client.id,
        name: client.name,
        domain: client.domain,
        industry: client.industry,
      },
      onboarding_version: ONBOARDING_VERSION,
      onboarding,
      profile,
      completeness: memory?.completeness ?? 0,
    })
  } catch (err) {
    console.error('[Onboarding GET] Error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

// ─── PATCH ────────────────────────────────────────────────────
export async function PATCH(
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

    const sectionId: string | undefined =
      typeof body.section_id === 'string' ? body.section_id : undefined
    const values: Record<string, unknown> =
      body.values && typeof body.values === 'object' && !Array.isArray(body.values)
        ? body.values
        : {}
    const skippedFields: string[] = Array.isArray(body.skipped_fields)
      ? body.skipped_fields.filter((s: unknown): s is string => typeof s === 'string')
      : []
    const markSectionComplete: boolean = body.mark_section_complete === true

    if (sectionId && !findSectionById(sectionId)) {
      return Response.json({ error: `Unknown section_id: ${sectionId}` }, { status: 400 })
    }

    // Whitelist the incoming paths against the known onboarding fields
    // so a malicious caller can't overwrite arbitrary JSONB keys.
    const allowedPaths = new Set(ALL_ONBOARDING_FIELD_PATHS)
    const invalidPaths = Object.keys(values).filter(p => !allowedPaths.has(p))
    if (invalidPaths.length > 0) {
      return Response.json(
        { error: `Unknown field paths: ${invalidPaths.join(', ')}` },
        { status: 400 }
      )
    }
    const invalidSkipped = skippedFields.filter(p => !allowedPaths.has(p))
    if (invalidSkipped.length > 0) {
      return Response.json(
        { error: `Unknown skipped paths: ${invalidSkipped.join(', ')}` },
        { status: 400 }
      )
    }

    // Load current profile (may not exist yet).
    const { data: existing } = await supabase
      .from('client_memory')
      .select('profile, status, completeness')
      .eq('client_id', clientId)
      .maybeSingle()

    const currentProfile: Record<string, unknown> =
      (existing?.profile as Record<string, unknown> | null) || {}

    // Seed onboarding state block if missing.
    const existingOnboarding =
      (currentProfile.onboarding as MemoryProfile['onboarding']) ?? {
        version: ONBOARDING_VERSION,
        status: 'not_started' as const,
        completed_sections: [],
        skipped_fields: [],
      }

    // Apply field-level writes.
    for (const [path, value] of Object.entries(values)) {
      // A null/undefined explicit value clears the field (used for "undo").
      if (value === null || value === undefined) {
        setAtPath(currentProfile, path, undefined)
      } else {
        setAtPath(currentProfile, path, value)
      }
    }

    // Merge skipped fields: union, dedup, drop paths that now have values.
    const previouslySkipped = new Set(existingOnboarding.skipped_fields ?? [])
    for (const s of skippedFields) previouslySkipped.add(s)
    // If a field was skipped previously but now has a value, unskip it.
    const mergedSkipped = [...previouslySkipped].filter(path => {
      const v = getAtPath(currentProfile, path)
      return isEmptyValue(v)
    })

    // Completed sections.
    const completedSections = new Set(existingOnboarding.completed_sections ?? [])
    if (markSectionComplete && sectionId) completedSections.add(sectionId)

    const nowIso = new Date().toISOString()
    const startedAt = existingOnboarding.started_at ?? nowIso

    const newOnboarding: MemoryProfile['onboarding'] = {
      version: ONBOARDING_VERSION,
      status: existingOnboarding.status === 'completed'
        ? 'completed'
        : 'in_progress',
      completed_sections: [...completedSections],
      skipped_fields: mergedSkipped,
      last_section: sectionId ?? existingOnboarding.last_section,
      started_at: startedAt,
      completed_at: existingOnboarding.completed_at,
      discovery_chat_completed: existingOnboarding.discovery_chat_completed,
    }

    currentProfile.onboarding = newOnboarding as unknown as Record<string, unknown>

    // Upsert — if the row doesn't exist, seed it with sensible defaults.
    const upsertRow = existing
      ? {
          client_id: clientId,
          profile: currentProfile,
          updated_at: nowIso,
        }
      : {
          client_id: clientId,
          profile: currentProfile,
          facts: [] as ClientMemory['facts'],
          gaps: [] as ClientMemory['gaps'],
          answers: [] as ClientMemory['answers'],
          narrative: null,
          status: 'empty' as const,
          completeness: 0,
          updated_at: nowIso,
        }

    const { error: upsertError } = await supabase
      .from('client_memory')
      .upsert(upsertRow, { onConflict: 'client_id' })

    if (upsertError) {
      const msg =
        upsertError.message?.toLowerCase().includes('row-level security') ||
        upsertError.message?.toLowerCase().includes('permission')
          ? 'Permission denied. You need editor access on this client.'
          : upsertError.message
      return Response.json({ error: msg }, { status: 403 })
    }

    // Completeness hint: fraction of visible fields filled in (capped at 90
    // so the real LLM completeness after refresh can go higher).
    const totalFields = ALL_ONBOARDING_FIELD_PATHS.length
    const filled = ALL_ONBOARDING_FIELD_PATHS.filter(p => !isEmptyValue(getAtPath(currentProfile, p))).length
    const estimatedCompleteness = Math.min(90, Math.round((filled / totalFields) * 100))

    return Response.json({
      success: true,
      onboarding: newOnboarding,
      estimated_completeness: estimatedCompleteness,
      total_sections: ONBOARDING_SECTIONS.length,
    })
  } catch (err) {
    console.error('[Onboarding PATCH] Error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
