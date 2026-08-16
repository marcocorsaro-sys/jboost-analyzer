export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getContentTemplate, isContentTemplateKey, CONTENT_TEMPLATE_KEYS } from '@/lib/v4/content/bank'

/**
 * GET /api/v4/analyses/[id]/content-answers — the saved questionnaire rows,
 * so the form re-opens exactly where the analyst left it (drafts included).
 * Read through the user-scoped client: content_answers has the same RLS
 * predicate as its parent analysis.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('content_answers')
    .select('site_ref, template_key, question_num, selected')
    .eq('analysis_id', analysisId)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ analysisId, answers: data ?? [] })
}

const Body = z.object({
  site_ref: z.enum(['client', 'competitor_1', 'competitor_2', 'competitor_3', 'competitor_4']),
  template_key: z.string(),
  /** questionId -> selected answer. Partial sets are legal (draft saves). */
  answers: z.record(z.enum(['A', 'B', 'C', 'D'])),
})

/**
 * POST /api/v4/analyses/[id]/content-answers
 *
 * Save the analyst's Content questionnaire answers (Bibbia sheets 9a/9b) for
 * one (site, template). Upsert on (analysis, site, template, question), so
 * the form can be saved incrementally: partial answers are DRAFTS — this
 * route never scores anything. Completeness is judged at run time by the
 * Content worker, which pauses on needs_decision until the client has at
 * least one fully answered template.
 *
 * Everything is validated against the bank (the single source of truth for
 * questions and points): unknown template, unknown question id or an answer
 * key outside A-D are rejected, and the stored `points` are denormalized
 * FROM the bank — the client never gets to claim its own points.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // RLS decides access: if the analysis is not visible to this user, there
  // is nothing to answer.
  const { data: analysis, error: fetchError } = await supabase
    .from('analyses')
    .select('id')
    .eq('id', analysisId)
    .maybeSingle()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  let parsed: z.infer<typeof Body>
  try {
    parsed = Body.parse(await request.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  if (!isContentTemplateKey(parsed.template_key)) {
    return NextResponse.json(
      {
        error: `unknown content template "${parsed.template_key}"`,
        valid_templates: CONTENT_TEMPLATE_KEYS,
      },
      { status: 400 },
    )
  }
  const template = getContentTemplate(parsed.template_key)!

  // Map every submitted answer onto a bank question; an id the bank does not
  // know is a client bug, not something to store.
  const rows: Array<Record<string, unknown>> = []
  for (const [rawId, selected] of Object.entries(parsed.answers)) {
    const questionId = Number(rawId)
    const question = template.questions.find((q) => q.id === questionId)
    if (!question) {
      return NextResponse.json(
        {
          error: `unknown question "${rawId}" for template "${template.key}"`,
          valid_questions: template.questions.map((q) => q.id),
        },
        { status: 400 },
      )
    }
    const option = question.answers.find((a) => a.key === selected)!
    rows.push({
      analysis_id: analysisId,
      site_ref: parsed.site_ref,
      template_key: template.key,
      question_num: question.id,
      selected: option.key,
      // Denormalized for audit (Block 1 schema comment); the worker rescores
      // from the bank, so a stale value here can never change a score.
      points: option.points,
      question_area: question.area,
      weight: question.weight,
      answered_by: user.id,
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'no answers submitted' }, { status: 400 })
  }

  const db = createAdminClient()
  const { error: upsertError } = await db
    .from('content_answers')
    .upsert(rows, { onConflict: 'analysis_id,site_ref,template_key,question_num' })
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  const complete = template.questions.every((q) =>
    Object.prototype.hasOwnProperty.call(parsed.answers, String(q.id)),
  )

  return NextResponse.json({
    status: 'saved',
    site_ref: parsed.site_ref,
    template_key: template.key,
    saved: rows.length,
    /** Whether THIS submission covers the whole template (informative only). */
    submitted_all_questions: complete,
  })
}
