export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadAnalysisSites } from '@/lib/v4/runner/store'
import { callAnthropicWithUsage } from '@/lib/v4/drivers/jhorizon-extract'
import {
  AI_TAB_KEYS,
  AI_TAB_LABELS,
  buildTabExtractionPrompt,
  defaultTabPrompt,
  parseTabExtraction,
  readStoredTabs,
  type AiTabKey,
  type StoredTab,
} from '@/lib/v4/ai-visibility-tabs'

/**
 * AI Visibility detail tabs (Sentiment · Citation rate & fonti · Market share).
 *
 * State lives in analyses.v4_setup.ai_visibility_tabs (no migration, same
 * home as the global notes): per tab the analyst's customized prompt, the
 * pasted/uploaded answer and the structured reading of it. These tabs never
 * touch the driver score.
 *
 * GET  -> stored tabs + the default prompt of each tab for this site set.
 * PUT  -> { tab, prompt?, answer?, extract? }: saves what is sent; with
 *         extract:true (and a non-empty answer) runs the one LLM reading.
 */

async function authed() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { supabase, user: null }
  return { supabase, user }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: analysisId } = await context.params
  const { supabase, user } = await authed()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: analysis, error } = await supabase
    .from('analyses')
    .select('id, v4_setup')
    .eq('id', analysisId)
    .single()
  if (error || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  const { sites } = await loadAnalysisSites(supabase, analysisId)
  const defaults = Object.fromEntries(AI_TAB_KEYS.map((k) => [k, defaultTabPrompt(k, sites)]))

  return NextResponse.json({
    analysisId,
    sites: sites.map((s) => ({ site_ref: s.site_ref, domain: s.domain, name: s.name, is_client: s.is_client })),
    tabs: readStoredTabs((analysis as { v4_setup: Record<string, unknown> | null }).v4_setup),
    defaults,
  })
}

const MAX_ANSWER_CHARS = 120_000

const Body = z.object({
  tab: z.enum(AI_TAB_KEYS),
  /** null or blank = back to the default prompt. */
  prompt: z.string().max(8000).nullable().optional(),
  answer: z.string().max(MAX_ANSWER_CHARS).optional(),
  extract: z.boolean().optional(),
})

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: analysisId } = await context.params
  const { supabase, user } = await authed()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: analysis, error: fetchError } = await supabase
    .from('analyses')
    .select('id')
    .eq('id', analysisId)
    .maybeSingle()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  let body: z.infer<typeof Body>
  try {
    body = Body.parse(await request.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  const tab: AiTabKey = body.tab
  const { sites } = await loadAnalysisSites(supabase, analysisId)

  // Re-read the latest v4_setup right before writing: this route owns only
  // its own key and must not clobber a concurrent save of the others.
  const db = createAdminClient()
  const { data: latest, error: readError } = await db
    .from('analyses')
    .select('v4_setup')
    .eq('id', analysisId)
    .single()
  if (readError || !latest) {
    return NextResponse.json({ error: readError?.message ?? 'analysis not found' }, { status: 500 })
  }
  const setup = ((latest as { v4_setup: Record<string, unknown> | null }).v4_setup ?? {}) as Record<string, unknown>
  const stored = readStoredTabs(setup)
  const prev: StoredTab = stored[tab] ?? {
    prompt: null,
    answer: '',
    extraction: null,
    extraction_error: null,
    extracted_at: null,
    model: null,
    updated_at: '',
  }

  const now = new Date().toISOString()
  const next: StoredTab = {
    ...prev,
    prompt: body.prompt === undefined ? prev.prompt : body.prompt && body.prompt.trim() ? body.prompt : null,
    answer: body.answer === undefined ? prev.answer : body.answer,
    updated_at: now,
  }
  // A changed answer makes the previous reading stale: drop it rather than
  // show numbers that no longer match the text beside them.
  if (body.answer !== undefined && body.answer !== prev.answer) {
    next.extraction = null
    next.extraction_error = null
    next.extracted_at = null
    next.model = null
  }

  let extractionFailed: string | null = null
  if (body.extract) {
    if (!next.answer.trim()) {
      return NextResponse.json({ error: 'incolla prima la risposta da leggere' }, { status: 400 })
    }
    try {
      const result = await callAnthropicWithUsage(
        buildTabExtractionPrompt(tab, next.answer, sites),
        `AI Visibility · ${AI_TAB_LABELS[tab]}`,
        { maxTokens: 3000, timeoutMs: 50_000 },
      )
      const { extraction, error } = parseTabExtraction(tab, result.text, sites, next.answer)
      next.extraction = extraction
      next.extraction_error = error
      next.extracted_at = now
      next.model = result.model
      extractionFailed = error
    } catch (err) {
      extractionFailed = err instanceof Error ? err.message : String(err)
      next.extraction = null
      next.extraction_error = extractionFailed
      next.extracted_at = now
    }
  }

  const { error: writeError } = await db
    .from('analyses')
    .update({ v4_setup: { ...setup, ai_visibility_tabs: { ...(setup.ai_visibility_tabs as object | undefined), [tab]: next } } })
    .eq('id', analysisId)
  if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 })

  return NextResponse.json({ analysisId, tab, saved: next, extractionError: extractionFailed })
}
