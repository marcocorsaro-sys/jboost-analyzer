/**
 * Schema Radiography API.
 *
 * GET  — return the latest cached radiography for the client (instant).
 * POST — run a fresh radiography (discover 30 URLs, scrape, score, enrich)
 *        and persist it on client_schema_reports.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/tracking/activity'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'
import { runRadiography, type SchemaRadiographyReport } from '@/lib/schema/pipeline'

export const maxDuration = 300 // up to 5 min for 30 Firecrawl scrapes + LLM enrichments
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Parallel reads: client metadata + cached report (both keyed on params.id).
  const [{ data: client }, { data: row }] = await Promise.all([
    supabase.from('clients').select('id, domain').eq('id', params.id).single(),
    supabase
      .from('client_schema_reports')
      .select('report, created_at, updated_at')
      .eq('client_id', params.id)
      .maybeSingle(),
  ])

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json({
    domain: client.domain ?? null,
    report: (row?.report as SchemaRadiographyReport | null) ?? null,
    createdAt: row?.created_at ?? null,
    updatedAt: row?.updated_at ?? null,
  })
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: client } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('id', params.id)
    .single()
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }
  if (!client.domain) {
    return NextResponse.json({ error: 'Client has no domain configured' }, { status: 400 })
  }

  // Edit permission required to mutate the cached report.
  const [{ data: canEdit }, { data: isAdmin }] = await Promise.all([
    supabase.rpc('user_can_edit_client', { p_client_id: params.id }),
    supabase.rpc('jboost_is_admin'),
  ])
  if (!canEdit && !isAdmin) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // Optional body — caller may override sample size or skip enrichment.
  let body: { sampleSize?: number; skipEnrichment?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  try {
    const report = await runRadiography({
      domain: client.domain,
      sampleSize: body.sampleSize,
      skipEnrichment: body.skipEnrichment,
    })

    // Persist the report (single row per client).
    const { error: upsertError } = await supabase
      .from('client_schema_reports')
      .upsert(
        {
          client_id: params.id,
          report: report as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id' },
      )
    if (upsertError) {
      console.error('[schema] persist failed:', upsertError)
      return NextResponse.json({ error: `Persist failed: ${upsertError.message}` }, { status: 500 })
    }

    // Best-effort LLM cost tracking.
    if (report.usage.enrichmentCalls > 0) {
      trackLlmUsage({
        userId: user.id,
        clientId: params.id,
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        operation: 'schema_radiography_v1',
        inputTokens: report.usage.inputTokens,
        outputTokens: report.usage.outputTokens,
        metadata: {
          domain: client.domain,
          templates: report.templates.length,
          enrichment_calls: report.usage.enrichmentCalls,
          pages_scraped: report.discovery.actuallyScraped,
          current_score: report.overall.currentScore,
          projected_score: report.overall.projectedScore,
        },
      }).catch(() => {})
    }

    logActivity({
      userId: user.id,
      action: 'schema_radiography',
      resourceType: 'client',
      resourceId: params.id,
      details: {
        domain: client.domain,
        templates: report.templates.length,
        pages_scraped: report.discovery.actuallyScraped,
        current_score: report.overall.currentScore,
        projected_score: report.overall.projectedScore,
      },
    }).catch(() => {})

    return NextResponse.json({ report })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Radiography failed'
    console.error('[schema] radiography error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
