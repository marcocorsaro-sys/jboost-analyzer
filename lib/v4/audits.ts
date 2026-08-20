/**
 * V4 audits list — the query + state logic behind /audits and the Home
 * "Audits" widget (UX-UI Bibbia 04, "Navigation & Screens": "List of one-off
 * audits with score and date of the analysis").
 *
 * What counts as a V4 audit: an `analyses` row with `ref_date` set. Only the
 * V4 setup route (POST /api/v4/analyses) and the V4 start route write that
 * column; the V1 analyzer never does. This is the same discriminator the V4
 * runner relies on, and it also includes setups saved but not yet started
 * (no driver_runs yet → shown as draft).
 *
 * The state pill mirrors ResultsView's priority exactly
 * (running > needs_decision > draft > published):
 *   - running        → at least one enabled driver queued/running
 *   - needs_decision → at least one enabled driver waiting on a human call
 *   - draft          → unpublished edits pending, or nothing published yet
 *   - published      → a publish stamp exists and nothing else is pending
 *
 * Reads go through the caller's user-scoped Supabase client so RLS decides
 * visibility — the same access model as every /api/v4 route.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { linkedClientId } from '@/lib/v4/promote'

export type AuditState = 'running' | 'needs_decision' | 'draft' | 'published'

/** Translation keys + pill colors, aligned with ResultsView's pill. */
export const AUDIT_STATE_META: Record<
  AuditState,
  { labelKey: 'v4res.state_running' | 'v4res.state_needs_decision' | 'v4res.state_draft' | 'v4res.state_published'; color: string }
> = {
  running: { labelKey: 'v4res.state_running', color: '#14b8a6' },
  needs_decision: { labelKey: 'v4res.state_needs_decision', color: '#f59e0b' },
  draft: { labelKey: 'v4res.state_draft', color: '#6b7280' },
  published: { labelKey: 'v4res.state_published', color: '#c8e64a' },
}

export interface AuditRunSlice {
  enabled: boolean
  status: string
  score_absolute: number | null
  score_relative: number | null
}

export interface AuditEditSlice {
  published: boolean
  published_at: string | null
}

export interface AuditListItem {
  id: string
  /** Client brand name when given in setup, else the domain. */
  name: string
  domain: string | null
  createdAt: string
  refDate: string | null
  state: AuditState
  /** Mean of the completed drivers' scores (relative first, absolute as
   *  fallback), null while nothing has a score yet. */
  overallScore: number | null
  driversDone: number
  driversTotal: number
  /**
   * False = a setup saved as draft and never launched (no driver_runs yet):
   * the list offers "Resume setup" (wizard ?resume=<id>) instead of opening
   * a results page that has nothing to show.
   */
  started: boolean
  /**
   * The client this audit is tied to: a "Switch to client" promotion
   * (v4_setup.promoted_client_id) or the client picked in the wizard
   * (analyses.client_id). Null = still a plain prospect audit.
   */
  clientId: string | null
}

/** Pure state computation — same precedence as ResultsView's pill. */
export function computeAuditState(
  runs: AuditRunSlice[],
  edits: AuditEditSlice[],
): AuditState {
  const enabled = runs.filter((r) => r.enabled)
  if (enabled.some((r) => r.status === 'queued' || r.status === 'running')) return 'running'
  if (enabled.some((r) => r.status === 'needs_decision')) return 'needs_decision'
  if (edits.some((e) => !e.published)) return 'draft'
  if (edits.some((e) => e.published && e.published_at)) return 'published'
  return 'draft'
}

/** Mean score across completed drivers; null when no driver has one yet. */
export function computeOverallScore(runs: AuditRunSlice[]): number | null {
  const scores = runs
    .filter((r) => r.enabled && r.status === 'done')
    .map((r) => r.score_relative ?? r.score_absolute)
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s))
  if (scores.length === 0) return null
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
}

/**
 * The V4 audits visible to the caller, newest first.
 * Three batched queries (analyses → driver_runs → edits), never N+1.
 */
export async function listV4Audits(
  db: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<AuditListItem[]> {
  let query = db
    .from('analyses')
    .select('id, domain, brand_name, created_at, ref_date, client_id, v4_setup')
    .not('ref_date', 'is', null)
    .order('created_at', { ascending: false })
  if (opts.limit) query = query.limit(opts.limit)

  const { data: analyses } = await query
  const rows = (analyses ?? []) as Array<{
    id: string
    domain: string | null
    brand_name: string | null
    created_at: string
    ref_date: string | null
    client_id: string | null
    v4_setup: Record<string, unknown> | null
  }>
  if (rows.length === 0) return []

  const ids = rows.map((a) => a.id)
  const [{ data: runData }, { data: editData }] = await Promise.all([
    db
      .from('driver_runs')
      .select('analysis_id, enabled, status, score_absolute, score_relative')
      .in('analysis_id', ids),
    db
      .from('edits')
      .select('analysis_id, published, published_at')
      .in('analysis_id', ids),
  ])

  const runsByAnalysis = new Map<string, AuditRunSlice[]>()
  for (const r of (runData ?? []) as Array<AuditRunSlice & { analysis_id: string }>) {
    const list = runsByAnalysis.get(r.analysis_id) ?? []
    list.push(r)
    runsByAnalysis.set(r.analysis_id, list)
  }

  const editsByAnalysis = new Map<string, AuditEditSlice[]>()
  for (const e of (editData ?? []) as Array<AuditEditSlice & { analysis_id: string }>) {
    const list = editsByAnalysis.get(e.analysis_id) ?? []
    list.push(e)
    editsByAnalysis.set(e.analysis_id, list)
  }

  return rows.map((a) => {
    const runs = runsByAnalysis.get(a.id) ?? []
    const edits = editsByAnalysis.get(a.id) ?? []
    const enabled = runs.filter((r) => r.enabled)
    return {
      id: a.id,
      name: a.brand_name || a.domain || a.id,
      domain: a.domain,
      createdAt: a.created_at,
      refDate: a.ref_date,
      state: computeAuditState(runs, edits),
      overallScore: computeOverallScore(runs),
      driversDone: enabled.filter((r) => r.status === 'done').length,
      driversTotal: enabled.length,
      started: runs.length > 0,
      clientId: linkedClientId(a),
    }
  })
}
