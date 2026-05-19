// Per-category MarTech refresh — re-detect a single category (CMS,
// analytics, marketing_automation, ...) without re-running the full
// stack. Faster + far more reliable than the full pipeline (output is
// ~300 tokens instead of ~8K so Sonnet truncation isn't a risk).
//
// Reuses a cached Firecrawl scrape stored on
// client_martech_reports.completeness.firecrawl_cache (30 min TTL).
// Re-scrapes only when the cache is stale or missing.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/tracking/activity'
import {
  detectMartechCategoryLlm,
  scrapeWithFirecrawl,
  type FirecrawlScrapeResult,
} from '@/lib/martech/detect-llm'

export const maxDuration = 90
export const dynamic = 'force-dynamic'

const FIRECRAWL_CACHE_TTL_MS = 30 * 60 * 1000 // 30 min

interface FirecrawlCacheEntry {
  ok: boolean
  status: FirecrawlScrapeResult['status']
  detail?: string
  html: string | null
  markdown: string | null
  metadata: Record<string, unknown> | null
  credits_used: number
  cached_at: string
}

function cacheFresh(entry: FirecrawlCacheEntry | null): boolean {
  if (!entry || !entry.cached_at) return false
  return Date.now() - new Date(entry.cached_at).getTime() < FIRECRAWL_CACHE_TTL_MS
}

function cacheToScrape(entry: FirecrawlCacheEntry): FirecrawlScrapeResult {
  return {
    ok: entry.ok,
    status: entry.status,
    detail: entry.detail,
    html: entry.html,
    markdown: entry.markdown,
    metadata: entry.metadata,
    credits_used: entry.credits_used,
  }
}

function scrapeToCache(scrape: FirecrawlScrapeResult): FirecrawlCacheEntry {
  return {
    ok: scrape.ok,
    status: scrape.status,
    detail: scrape.detail,
    html: scrape.html,
    markdown: scrape.markdown,
    metadata: scrape.metadata,
    credits_used: scrape.credits_used,
    cached_at: new Date().toISOString(),
  }
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

  let body: { category?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const category = (body.category ?? '').trim().toLowerCase()
  if (!category || !/^[a-z_]+$/.test(category)) {
    return NextResponse.json({ error: 'category required (snake_case)' }, { status: 400 })
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

  // Authorize via RLS-aware RPCs.
  const [{ data: canEdit }, { data: isAdmin }] = await Promise.all([
    supabase.rpc('user_can_edit_client', { p_client_id: params.id }),
    supabase.rpc('jboost_is_admin'),
  ])
  if (!canEdit && !isAdmin) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // 1. Read existing report (we'll need the firecrawl_cache + write back).
  const { data: existingReport } = await supabase
    .from('client_martech_reports')
    .select('completeness')
    .eq('client_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const report = (existingReport?.completeness as Record<string, unknown> | null) ?? {}

  // 2. Get a Firecrawl scrape — cache hit if fresh, otherwise re-scrape.
  const cache = (report.firecrawl_cache as FirecrawlCacheEntry | null) ?? null
  let scrape: FirecrawlScrapeResult
  let cacheHit = false
  if (cacheFresh(cache) && cache) {
    scrape = cacheToScrape(cache)
    cacheHit = true
  } else {
    scrape = await scrapeWithFirecrawl(`https://${client.domain}`, {
      formats: ['html', 'markdown'],
      waitFor: 8000,
    })
  }

  if (!scrape.ok) {
    return NextResponse.json({
      error: `Firecrawl unavailable: ${scrape.status}${scrape.detail ? ' — ' + scrape.detail : ''}`,
    }, { status: 502 })
  }

  // 3. Focused single-category LLM analysis.
  const { tools, usage, error: llmError } = await detectMartechCategoryLlm(
    client.domain,
    category,
    scrape,
  )
  if (llmError) {
    return NextResponse.json({ error: llmError }, { status: 502 })
  }

  // 4. Replace the slice of client_martech for this category.
  await supabase
    .from('client_martech')
    .delete()
    .eq('client_id', params.id)
    .eq('category', category)
  if (tools.length > 0) {
    const rows = tools.map(t => ({
      client_id: params.id,
      category: t.category,
      tool_name: t.tool_name,
      tool_version: t.tool_version,
      confidence: t.confidence,
      details: t.details,
      detected_at: new Date().toISOString(),
    }))
    const { error: insertError } = await supabase
      .from('client_martech')
      .insert(rows)
    if (insertError) {
      return NextResponse.json({ error: `DB insert failed: ${insertError.message}` }, { status: 500 })
    }
  }

  // 5. Persist the fresh scrape into the cache when we did the work.
  if (!cacheHit) {
    const updatedReport = { ...report, firecrawl_cache: scrapeToCache(scrape) }
    await supabase
      .from('client_martech_reports')
      .upsert({
        client_id: params.id,
        completeness: updatedReport,
        created_at: new Date().toISOString(),
      }, { onConflict: 'client_id' })
  }

  logActivity({
    userId: user.id,
    action: 'martech_category_refresh',
    resourceType: 'client',
    resourceId: params.id,
    details: {
      category,
      tools_detected: tools.length,
      cache_hit: cacheHit,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    },
  }).catch(() => {})

  // Return the fresh slice + the unchanged-or-fresh full snapshot so the UI
  // can refresh without a second GET.
  const { data: martech } = await supabase
    .from('client_martech')
    .select('*')
    .eq('client_id', params.id)
    .order('category')
    .order('tool_name')

  return NextResponse.json({
    success: true,
    category,
    detected: tools.length,
    tools,
    cache_hit: cacheHit,
    martech: martech ?? [],
  })
}
