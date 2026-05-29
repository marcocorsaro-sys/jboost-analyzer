/**
 * Per-template refresh: re-scrape one sample page and re-score + re-enrich
 * one template. Updates the matching slice of the cached report so the UI can
 * refresh just that card without re-running the whole pipeline.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/tracking/activity'
import { enforceSpendLimit } from '@/lib/tracking/spend-limit'
import { refreshTemplate, type SchemaRadiographyReport, type TemplateReport } from '@/lib/schema/pipeline'
import { overallScore } from '@/lib/schema/score'
import type { PageRole } from '@/lib/schema/rubrics'

export const maxDuration = 90
export const dynamic = 'force-dynamic'

const VALID_ROLES: PageRole[] = [
  'homepage', 'product', 'article', 'blog', 'news', 'faq', 'category',
  'about', 'contact', 'event', 'recipe', 'video', 'location', 'breadcrumb', 'other',
]

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const limited = await enforceSpendLimit(supabase)
  if (limited) return limited

  let body: { rubricType?: string; pageRole?: string; sampleUrl?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const rubricType = (body.rubricType ?? '').trim()
  const pageRole = (body.pageRole ?? '').trim() as PageRole
  const sampleUrl = (body.sampleUrl ?? '').trim()
  if (!rubricType || !VALID_ROLES.includes(pageRole) || !/^https?:\/\//i.test(sampleUrl)) {
    return NextResponse.json({ error: 'rubricType, pageRole, sampleUrl required' }, { status: 400 })
  }

  const { data: client } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('id', params.id)
    .single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (!client.domain) {
    return NextResponse.json({ error: 'Client has no domain configured' }, { status: 400 })
  }

  const [{ data: canEdit }, { data: isAdmin }] = await Promise.all([
    supabase.rpc('user_can_edit_client', { p_client_id: params.id }),
    supabase.rpc('jboost_is_admin'),
  ])
  if (!canEdit && !isAdmin) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const refreshed = await refreshTemplate({
    domain: client.domain,
    rubricType,
    pageRole,
    sampleUrl,
  })
  if (!refreshed) {
    return NextResponse.json(
      { error: `No ${rubricType} block found at ${sampleUrl} after rescrape` },
      { status: 404 },
    )
  }

  // Splice the refreshed template into the cached report.
  const { data: row } = await supabase
    .from('client_schema_reports')
    .select('report')
    .eq('client_id', params.id)
    .maybeSingle()
  const report = (row?.report as SchemaRadiographyReport | null) ?? null
  if (report) {
    const idx = report.templates.findIndex(
      (t: TemplateReport) => t.type === rubricType && t.pageRole === pageRole,
    )
    if (idx >= 0) {
      // Preserve the previous occurrence count + sample URL set — the single
      // page we re-scraped doesn't tell us about the rest of the site.
      const prev = report.templates[idx]
      report.templates[idx] = {
        ...refreshed,
        occurrences: prev.occurrences,
        pagesCrawled: prev.pagesCrawled,
      }
    } else {
      report.templates.unshift(refreshed)
    }
    // Recompute overall + projected at the report level.
    const currentScores = report.templates.map(t => t.score)
    const projectedScores = report.templates.map(t => t.projectedScore)
    const current = overallScore(currentScores)
    const projected = overallScore(projectedScores)
    report.overall = {
      currentScore: current,
      projectedScore: projected,
      delta: projected - current,
    }

    await supabase
      .from('client_schema_reports')
      .upsert(
        {
          client_id: params.id,
          report: report as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id' },
      )
  }

  logActivity({
    userId: user.id,
    action: 'schema_template_refresh',
    resourceType: 'client',
    resourceId: params.id,
    details: { rubricType, pageRole, sampleUrl, score: refreshed.score, projected: refreshed.projectedScore },
  }).catch(() => {})

  return NextResponse.json({ template: refreshed, report })
}
