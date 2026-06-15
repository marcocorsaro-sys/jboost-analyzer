import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createClient } from '@/lib/supabase/server'
import { apiFetch, postJson, fromApi, toolOk, toolError } from './api-client'

// Extracts the validated bearer token that withMcpAuth attached to the call.
function tokenFrom(extra: { authInfo?: { token?: string } }): string {
  const token = extra?.authInfo?.token
  if (!token) throw new Error('Unauthenticated MCP call (no bearer token)')
  return token
}

const LIFECYCLE = ['prospect', 'active', 'churned', 'archived'] as const

/**
 * Registers every JBoost capability as an MCP tool. Tools are thin wrappers:
 * read-only lookups hit Supabase directly through the bearer-aware client,
 * while anything with side effects, spend limits or LLM calls is proxied to
 * the existing API route so business logic is never duplicated.
 */
export function registerTools(server: McpServer): void {
  // ── Identity ──────────────────────────────────────────────────────────
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description: 'Returns the authenticated user behind the current bearer token.',
      inputSchema: {},
    },
    async (_args, extra) => {
      const token = tokenFrom(extra)
      const supabase = await createClient()
      const { data, error } = await supabase.auth.getUser()
      if (error || !data?.user) return toolError('Not authenticated', error?.message)
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, full_name, role')
        .eq('id', data.user.id)
        .maybeSingle()
      return toolOk({ user: { id: data.user.id, email: data.user.email }, profile, tokenPresent: !!token })
    }
  )

  // ── Clients ───────────────────────────────────────────────────────────
  server.registerTool(
    'list_clients',
    {
      title: 'List clients',
      description: 'Lists clients the user can access (RLS-scoped), enriched with analysis stats. Optionally filter by lifecycle stage.',
      inputSchema: {
        stage: z.enum(LIFECYCLE).optional().describe('Filter by lifecycle stage'),
      },
    },
    async ({ stage }, extra) => {
      const qs = stage ? `?stage=${stage}` : ''
      return fromApi(await apiFetch(tokenFrom(extra), `/api/clients${qs}`))
    }
  )

  server.registerTool(
    'get_client',
    {
      title: 'Get client',
      description: 'Fetches a single client by id, with its details.',
      inputSchema: { clientId: z.string().uuid() },
    },
    async ({ clientId }, extra) =>
      fromApi(await apiFetch(tokenFrom(extra), `/api/clients/${clientId}`))
  )

  server.registerTool(
    'create_client',
    {
      title: 'Create client',
      description: 'Creates a new client. Seeds the caller as owner. Defaults lifecycle stage to "prospect".',
      inputSchema: {
        name: z.string().min(1),
        domain: z.string().optional(),
        industry: z.string().optional(),
        website_url: z.string().optional(),
        contact_name: z.string().optional(),
        contact_email: z.string().optional(),
        contact_phone: z.string().optional(),
        notes: z.string().optional(),
        lifecycle_stage: z.enum(LIFECYCLE).optional(),
        pre_sales_notes: z.string().optional(),
      },
    },
    async (args, extra) => fromApi(await postJson(tokenFrom(extra), '/api/clients', args))
  )

  server.registerTool(
    'update_client',
    {
      title: 'Update client',
      description: 'Updates editable fields of a client (PATCH). Pass only the fields to change.',
      inputSchema: {
        clientId: z.string().uuid(),
        name: z.string().optional(),
        domain: z.string().optional(),
        industry: z.string().optional(),
        website_url: z.string().optional(),
        contact_name: z.string().optional(),
        contact_email: z.string().optional(),
        contact_phone: z.string().optional(),
        notes: z.string().optional(),
        lifecycle_stage: z.enum(LIFECYCLE).optional(),
        pre_sales_notes: z.string().optional(),
      },
    },
    async ({ clientId, ...updates }, extra) =>
      fromApi(
        await apiFetch(tokenFrom(extra), `/api/clients/${clientId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(updates),
        })
      )
  )

  server.registerTool(
    'get_client_memory',
    {
      title: 'Get client memory',
      description: 'Returns the Client Memory v2 profile, facts, gaps and answers for a client.',
      inputSchema: { clientId: z.string().uuid() },
    },
    async ({ clientId }, extra) =>
      fromApi(await apiFetch(tokenFrom(extra), `/api/clients/${clientId}/memory`))
  )

  server.registerTool(
    'get_client_martech',
    {
      title: 'Get client MarTech stack',
      description: 'Returns the detected marketing-technology stack for a client.',
      inputSchema: { clientId: z.string().uuid() },
    },
    async ({ clientId }, extra) =>
      fromApi(await apiFetch(tokenFrom(extra), `/api/clients/${clientId}/martech`))
  )

  // ── Analyses ──────────────────────────────────────────────────────────
  server.registerTool(
    'list_analyses',
    {
      title: 'List analyses',
      description: 'Lists analyses visible to the user (RLS-scoped), newest first. Optionally filter by client.',
      inputSchema: {
        clientId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ clientId, limit }, extra) => {
      tokenFrom(extra)
      const supabase = await createClient()
      let query = supabase
        .from('analyses')
        .select('id, client_id, domain, country, language, status, overall_score, source, created_at, completed_at')
        .order('created_at', { ascending: false })
        .limit(limit ?? 25)
      if (clientId) query = query.eq('client_id', clientId)
      const { data, error } = await query
      if (error) return toolError('Failed to list analyses', error.message)
      return toolOk({ analyses: data ?? [] })
    }
  )

  server.registerTool(
    'get_analysis',
    {
      title: 'Get analysis',
      description: 'Fetches a full analysis: the analysis row, per-driver results, competitor results and priority matrix.',
      inputSchema: { analysisId: z.string().uuid() },
    },
    async ({ analysisId }, extra) => {
      tokenFrom(extra)
      const supabase = await createClient()
      const { data: analysis, error } = await supabase
        .from('analyses')
        .select('*')
        .eq('id', analysisId)
        .single()
      if (error || !analysis) return toolError('Analysis not found or no access', error?.message)
      const [drivers, competitors, matrix] = await Promise.all([
        supabase.from('driver_results').select('*').eq('analysis_id', analysisId),
        supabase.from('competitor_results').select('*').eq('analysis_id', analysisId),
        supabase.from('priority_matrix').select('*').eq('analysis_id', analysisId).maybeSingle(),
      ])
      return toolOk({
        analysis,
        driver_results: drivers.data ?? [],
        competitor_results: competitors.data ?? [],
        priority_matrix: matrix.data ?? null,
      })
    }
  )

  server.registerTool(
    'get_analysis_status',
    {
      title: 'Get analysis status',
      description: 'Lightweight poll of an analysis run: status, current phase and error (if any).',
      inputSchema: { analysisId: z.string().uuid() },
    },
    async ({ analysisId }, extra) => {
      tokenFrom(extra)
      const supabase = await createClient()
      const { data, error } = await supabase
        .from('analyses')
        .select('id, status, current_phase, phase_detail, started_at, completed_at, error_message, paused_at_phase, overall_score')
        .eq('id', analysisId)
        .single()
      if (error || !data) return toolError('Analysis not found or no access', error?.message)
      return toolOk(data)
    }
  )

  server.registerTool(
    'run_analysis',
    {
      title: 'Run analysis',
      description: 'Triggers the 9-driver orchestration for an existing, not-yet-completed analysis. Returns 202 when accepted. Respects the workspace spend limit.',
      inputSchema: { analysisId: z.string().uuid() },
    },
    async ({ analysisId }, extra) =>
      fromApi(await postJson(tokenFrom(extra), '/api/analyses/run', { analysisId }))
  )

  server.registerTool(
    'create_and_run_analysis',
    {
      title: 'Create and run analysis',
      description: 'Creates a new analysis for a domain (optionally tied to a client) and immediately triggers the 9-driver run. Respects the workspace spend limit.',
      inputSchema: {
        domain: z.string().min(1).describe('Domain to analyze, e.g. "example.com"'),
        clientId: z.string().uuid().optional(),
        country: z.string().optional().describe('ISO country code, default "IT"'),
        language: z.string().optional().describe('Language code, default "it"'),
        targetTopic: z.string().optional(),
        competitors: z.array(z.string()).optional(),
      },
    },
    async ({ domain, clientId, country, language, targetTopic, competitors }, extra) => {
      const token = tokenFrom(extra)
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return toolError('Not authenticated')

      const cleanDomain = domain
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
        .toLowerCase()

      const { data: analysis, error: insertError } = await supabase
        .from('analyses')
        .insert({
          user_id: user.id,
          domain: cleanDomain,
          country: country || 'IT',
          language: language || 'it',
          target_topic: targetTopic || null,
          competitors: competitors ?? [],
          status: 'running',
          source: 'mcp',
          ...(clientId ? { client_id: clientId } : {}),
        })
        .select('id')
        .single()

      if (insertError || !analysis) {
        return toolError('Failed to create analysis', insertError?.message)
      }

      const run = await postJson(token, '/api/analyses/run', { analysisId: analysis.id })
      if (!run.ok) {
        return toolError(`Analysis ${analysis.id} created but run trigger failed (HTTP ${run.status})`, run.body)
      }
      return toolOk({ analysisId: analysis.id, domain: cleanDomain, run: run.body })
    }
  )

  // ── Knowledge base (RAG) ──────────────────────────────────────────────
  server.registerTool(
    'search_knowledge',
    {
      title: 'Search knowledge base',
      description: "Vector (semantic) search over a client's knowledge base.",
      inputSchema: {
        clientId: z.string().uuid(),
        query: z.string().min(1),
        topK: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ clientId, query, topK }, extra) =>
      fromApi(await postJson(tokenFrom(extra), '/api/knowledge/search', { clientId, query, topK }))
  )

  server.registerTool(
    'list_knowledge_documents',
    {
      title: 'List knowledge documents',
      description: "Lists documents in a client's knowledge base.",
      inputSchema: {
        clientId: z.string().uuid(),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ clientId, status, limit }, extra) => {
      const params = new URLSearchParams({ clientId })
      if (status) params.set('status', status)
      if (limit) params.set('limit', String(limit))
      return fromApi(await apiFetch(tokenFrom(extra), `/api/knowledge/documents?${params}`))
    }
  )

  server.registerTool(
    'ingest_knowledge_text',
    {
      title: 'Ingest text into knowledge base',
      description: "Adds a plain-text document to a client's knowledge base (chunked + embedded for RAG).",
      inputSchema: {
        clientId: z.string().uuid(),
        title: z.string().min(1).describe('Document title / source name'),
        text: z.string().min(1),
      },
    },
    async ({ clientId, title, text }, extra) => {
      const form = new FormData()
      const fileName = /\.(txt|md)$/i.test(title) ? title : `${title}.txt`
      form.set('file', new Blob([text], { type: 'text/plain' }), fileName)
      form.set('clientId', clientId)
      return fromApi(
        await apiFetch(tokenFrom(extra), '/api/knowledge/ingest', { method: 'POST', body: form })
      )
    }
  )

  // ── LLM insights ──────────────────────────────────────────────────────
  server.registerTool(
    'suggest_solutions',
    {
      title: 'Suggest solutions for a driver',
      description: 'Generates 3-5 actionable, prioritized solutions for a driver of an analysis. Consumes LLM budget; respects the spend limit.',
      inputSchema: {
        analysisId: z.string().uuid(),
        driverName: z.string().min(1),
        score: z.number().optional(),
        issues: z.array(z.string()).optional(),
        domain: z.string().optional(),
        clientId: z.string().uuid().optional(),
        locale: z.enum(['it', 'es', 'fr', 'en']).optional(),
      },
    },
    async (args, extra) => fromApi(await postJson(tokenFrom(extra), '/api/llm/solutions', args))
  )

  server.registerTool(
    'priority_matrix',
    {
      title: 'Build priority matrix',
      description: 'Builds an impact/effort priority matrix for an analysis. Consumes LLM budget; respects the spend limit.',
      inputSchema: {
        analysisId: z.string().uuid(),
        clientId: z.string().uuid().optional(),
        locale: z.enum(['it', 'es', 'fr', 'en']).optional(),
      },
    },
    async (args, extra) => fromApi(await postJson(tokenFrom(extra), '/api/llm/priority-matrix', args))
  )

  // ── Account ───────────────────────────────────────────────────────────
  server.registerTool(
    'spend_status',
    {
      title: 'Spend status',
      description: 'Returns the current LLM/API spend status against the workspace limit.',
      inputSchema: {},
    },
    async (_args, extra) => fromApi(await apiFetch(tokenFrom(extra), '/api/spend-status'))
  )
}
