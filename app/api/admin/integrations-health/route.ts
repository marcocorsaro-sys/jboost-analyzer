import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { PROBES, type ProbeResult } from '@/lib/admin/integration-probes'

export const dynamic = 'force-dynamic'
// Allow the longest single probe (PSI ~30s) plus parallel overhead.
export const maxDuration = 60

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return null
  return { supabase, user }
}

/** Load API keys with the same precedence as run-analysis: app_config row wins over env. */
async function loadAllKeys(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ map: Record<string, string>; sources: Record<string, 'db' | 'env'> }> {
  const map: Record<string, string> = {}
  const sources: Record<string, 'db' | 'env'> = {}
  // env first
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && v.length > 0) {
      map[k] = v
      sources[k] = 'env'
    }
  }
  // db overrides
  try {
    const { data } = await supabase.from('app_config').select('key, value')
    if (data) {
      for (const row of data as Array<{ key: string; value: string }>) {
        if (row.value) {
          map[row.key] = row.value
          sources[row.key] = 'db'
        }
      }
    }
  } catch {
    // If app_config is unreachable, fall back to env-only — the probes will still run.
  }
  return { map, sources }
}

interface InventoryRow {
  id: string
  label: string
  envKeys: string[]
  costHint: string
  configured: boolean
  /** Per-key source: 'db' | 'env' | 'missing'. */
  keySources: Record<string, 'db' | 'env' | 'missing'>
}

function buildInventory(
  keyMap: Record<string, string>,
  keySources: Record<string, 'db' | 'env'>,
): InventoryRow[] {
  return PROBES.map(probe => {
    const sources: Record<string, 'db' | 'env' | 'missing'> = {}
    let allPresent = true
    for (const k of probe.envKeys) {
      if (keyMap[k]) {
        sources[k] = keySources[k] ?? 'env'
      } else {
        sources[k] = 'missing'
        allPresent = false
      }
    }
    return {
      id: probe.id,
      label: probe.label,
      envKeys: probe.envKeys,
      costHint: probe.costHint,
      configured: allPresent,
      keySources: sources,
    }
  })
}

// ─── GET /api/admin/integrations-health ─────────────────────
// Returns the inventory (which providers are configured and from where).
// Does NOT run any live probes — those are POST-only to keep cost explicit.
export async function GET() {
  const auth = await requireAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { map, sources } = await loadAllKeys(auth.supabase)
  const inventory = buildInventory(map, sources)
  return NextResponse.json({ inventory })
}

// ─── POST /api/admin/integrations-health ────────────────────
// Body: { ids?: string[] }  — omit to test ALL configured providers, or pass
// a subset of probe ids to test only those.
// Skips probes whose required keys are missing (returns ok=false with a clear
// "not configured" message so the UI can show the row anyway).
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const requestedIds: string[] | null = Array.isArray(body?.ids) && body.ids.length > 0 ? body.ids : null

  const { map } = await loadAllKeys(auth.supabase)

  const targets = PROBES.filter(p => requestedIds === null || requestedIds.includes(p.id))

  const settled = await Promise.allSettled(
    targets.map(async probe => {
      const missing = probe.envKeys.filter(k => !map[k])
      if (missing.length > 0) {
        const result: ProbeResult = {
          ok: false,
          latency_ms: 0,
          message: `Not configured: missing ${missing.join(', ')}`,
        }
        return { id: probe.id, result }
      }
      const keys: Record<string, string> = {}
      for (const k of probe.envKeys) keys[k] = map[k]
      const result = await probe.run(keys)
      return { id: probe.id, result }
    }),
  )

  const results: Record<string, ProbeResult & { tested_at: string }> = {}
  const tested_at = new Date().toISOString()
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results[s.value.id] = { ...s.value.result, tested_at }
    }
    // If a probe rejected for some unexpected reason (it shouldn't — each one
    // already try/catches), surface it under the matching id when possible.
  }
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]
    if (s.status === 'rejected') {
      const id = targets[i].id
      results[id] = {
        ok: false,
        latency_ms: 0,
        message: s.reason instanceof Error ? s.reason.message : String(s.reason),
        tested_at,
      }
    }
  }

  return NextResponse.json({ results })
}
