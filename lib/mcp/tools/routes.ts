/**
 * MCP tools — lazy route-handler loaders.
 *
 * The route modules pull in next/server and server-only helpers (Supabase
 * clients, the runner). Importing them at module top level would make the
 * whole tool registry impossible to load under `tsx --test` without Next, so
 * each handler is imported on first use, inside run(). Tests replace an entry
 * with a fake handler (`routes.status = async () => fakeGet`), which also lets
 * them exercise the tools' composition and compaction end to end.
 */

import type { RouteHandler } from '@/lib/mcp/call-route'
import { McpToolError } from '@/lib/mcp/types'
import { listV4Audits, type AuditListItem } from '@/lib/v4/audits'

export type RouteLoader = () => Promise<RouteHandler>

export const routes = {
  /** GET /api/v4/analyses/[id]/status — per-driver rows + progress + sites. */
  status: (async () =>
    (await import('@/app/api/v4/analyses/[id]/status/route')).GET) as RouteLoader,
  /** GET /api/v4/analyses/[id] — the saved setup (wizard shape). */
  analysisGet: (async () =>
    (await import('@/app/api/v4/analyses/[id]/route')).GET) as RouteLoader,
  /** PATCH /api/v4/analyses/[id] — notes-only body { global_notes }. */
  analysisPatch: (async () =>
    (await import('@/app/api/v4/analyses/[id]/route')).PATCH) as RouteLoader,
  /** POST /api/v4/analyses — create (draft | launch). */
  analysesPost: (async () =>
    (await import('@/app/api/v4/analyses/route')).POST) as RouteLoader,
  /** GET /api/v4/analyses/[id]/insights — insights + executive summary. */
  insightsGet: (async () =>
    (await import('@/app/api/v4/analyses/[id]/insights/route')).GET) as RouteLoader,
  /** POST /api/v4/analyses/[id]/insights — generate (full or targeted). */
  insightsPost: (async () =>
    (await import('@/app/api/v4/analyses/[id]/insights/route')).POST) as RouteLoader,
  /** GET /api/v4/analyses/[id]/controller — deterministic reviewer findings. */
  controllerGet: (async () =>
    (await import('@/app/api/v4/analyses/[id]/controller/route')).GET) as RouteLoader,
  /** POST /api/v4/analyses/[id]/start */
  start: (async () =>
    (await import('@/app/api/v4/analyses/[id]/start/route')).POST) as RouteLoader,
  /** POST /api/v4/analyses/[id]/retry */
  retry: (async () =>
    (await import('@/app/api/v4/analyses/[id]/retry/route')).POST) as RouteLoader,
  /** POST /api/v4/analyses/[id]/publish */
  publish: (async () =>
    (await import('@/app/api/v4/analyses/[id]/publish/route')).POST) as RouteLoader,
  /** POST /api/v4/analyses/[id]/drivers/[key]/decision */
  decision: (async () =>
    (await import('@/app/api/v4/analyses/[id]/drivers/[key]/decision/route')).POST) as RouteLoader,
  /** GET /api/clients */
  clientsGet: (async () => (await import('@/app/api/clients/route')).GET) as RouteLoader,
  /** GET /api/clients/[id] — note: this route reads params synchronously. */
  clientGet: (async () => (await import('@/app/api/clients/[id]/route')).GET) as RouteLoader,
}

export type RouteName = keyof typeof routes

/**
 * Non-route data sources, lazy for the same reason as the routes above.
 *
 * `audits`: GET /api/v4/analyses only returns four fields (it feeds a wizard
 * select), so the listing tools use the same listV4Audits the /audits page
 * uses, on the SAME bearer-aware user-scoped client: RLS decides visibility,
 * no elevated rights.
 */
export const sources = {
  audits: async (limit: number): Promise<AuditListItem[]> => {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (error || !user) {
      throw new McpToolError('Not authenticated: the user must reconnect the connector.')
    }
    return listV4Audits(supabase, { limit })
  },
  /** Resolve a project code (JBA-0020) to the audit UUID, RLS-scoped. Null = no such audit for this user. */
  auditIdByCode: async (code: string): Promise<string | null> => {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (error || !user) {
      throw new McpToolError('Not authenticated: the user must reconnect the connector.')
    }
    const { data } = await supabase.from('analyses').select('id').eq('project_code', code).maybeSingle()
    return (data as { id: string } | null)?.id ?? null
  },
}
