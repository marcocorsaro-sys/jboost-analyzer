/**
 * V4 driver — Content.
 *
 * Source: the ANALYST QUESTIONNAIRE of Bibbia sheets 9a/9b (registry:
 * "Analyst questionnaire per template"), replacing the earlier SEMrush-slice
 * method which the spec superseded. There is no API: the measurement is a
 * human assessment, per page template, with four graded answers per question
 * whose points are embedded in the bank (lib/v4/content/bank.ts —
 * authoritative per the 9a note).
 *
 * Scoring (lib/v4/content/score.ts):
 *   template_score = 100 * points / max points of the template (round 0.1)
 *   site raw       = mean of the site's COMPILED templates (round 0.1)
 * Templates not compiled are EXCLUDED, never scored 0 (9a rule). The
 * per-template normalization is the project decision (2026-08-11) that
 * absorbs the Article anomaly documented in the bank header.
 *
 * Like AI Visibility, a run without input is a PAUSE, not a failure: the
 * client questionnaire missing yields `needs_decision`, the analyst fills
 * the form (POST /api/v4/analyses/[id]/content-answers), answers the
 * decision, and the requeued job re-reads content_answers via the context
 * (ctx.contentAnswers, loaded by execute — the worker holds no DB handle).
 *
 * Competitors are OPTIONAL (Content is a Development driver, 9a v5): a
 * competitor with no complete template stays unmeasured — writing 0 would
 * claim we assessed its content as "all very bad", which we did not.
 */

import { getContentTemplate } from '@/lib/v4/content/bank'
import { band, overallContent, templateScore } from '@/lib/v4/content/score'
import type { ContentAnswerKey } from '@/lib/v4/content/bank'
import type { ContentAnswerRow, DriverWorker, SiteRawValue, SiteRef } from '@/lib/v4/runner/types'

interface SiteTemplateEvidence {
  template: string
  score: number
  band: string
  /** Questions answered (= all of them: only complete templates are scored). */
  answered: number
}

export interface SiteContentComputation {
  /** null = no fully compiled template: the site is not measured. */
  overall: number | null
  perTemplate: SiteTemplateEvidence[]
  /** Templates with some answers but not all — visible, never silently dropped. */
  incomplete: Array<{ template: string; answered: number; total: number }>
}

/**
 * Pure: score one site from its answer rows.
 *
 * Only templates the analyst COMPLETELY answered are scored; partially
 * answered ones are reported as incomplete (a draft is not a measurement).
 * Rows with an unknown template key are ignored defensively — the DB CHECK
 * and the API route both validate against the bank, so they should not
 * exist, but an unknown key must not crash the whole site.
 */
export function computeSiteContent(rows: ContentAnswerRow[]): SiteContentComputation {
  const byTemplate = new Map<string, Map<number, ContentAnswerKey>>()
  for (const row of rows) {
    if (!row.selected) continue // draft row without a choice: not an answer
    if (!getContentTemplate(row.template_key)) continue
    let bucket = byTemplate.get(row.template_key)
    if (!bucket) {
      bucket = new Map()
      byTemplate.set(row.template_key, bucket)
    }
    bucket.set(row.question_num, row.selected)
  }

  const perTemplate: SiteTemplateEvidence[] = []
  const incomplete: SiteContentComputation['incomplete'] = []

  for (const [templateKey, answered] of byTemplate) {
    const template = getContentTemplate(templateKey)
    if (!template) continue
    const complete = template.questions.every((q) => answered.has(q.id))
    if (!complete) {
      incomplete.push({
        template: templateKey,
        answered: answered.size,
        total: template.questions.length,
      })
      continue
    }
    const result = templateScore(templateKey, Object.fromEntries(answered))
    perTemplate.push({
      template: templateKey,
      score: result.score,
      band: band(result.score),
      answered: result.perQuestion.length,
    })
  }

  return {
    overall: overallContent(perTemplate.map((t) => t.score)),
    perTemplate,
    incomplete,
  }
}

export const contentWorker: DriverWorker = async (ctx) => {
  const answers = ctx.contentAnswers ?? []

  const bySite = new Map<SiteRef, ContentAnswerRow[]>()
  for (const row of answers) {
    const bucket = bySite.get(row.site_ref) ?? []
    bucket.push(row)
    bySite.set(row.site_ref, bucket)
  }

  const measured: SiteRawValue[] = []
  const incompleteBySite: Record<string, SiteContentComputation['incomplete']> = {}

  for (const site of ctx.sites) {
    const computed = computeSiteContent(bySite.get(site.site_ref) ?? [])
    if (computed.incomplete.length > 0) incompleteBySite[site.site_ref] = computed.incomplete
    if (computed.overall === null) continue // no compiled template: unmeasured, never 0
    measured.push({
      site_ref: site.site_ref,
      domain: site.domain,
      raw: computed.overall,
      score_absolute: Math.round(computed.overall),
      evidence: {
        per_template: computed.perTemplate,
        templates_evaluated: computed.perTemplate.length,
        templates_incomplete: computed.incomplete,
        method: 'questionnaire_9a_9b',
      },
    })
  }

  const clientRef = ctx.sites.find((s) => s.is_client)?.site_ref
  if (!measured.some((s) => s.site_ref === clientRef)) {
    // The client questionnaire is the mandatory input; without it the job
    // pauses for the analyst (same pattern as AI Visibility) instead of
    // failing or — worse — writing a score for an assessment nobody made.
    const clientIncomplete = clientRef ? incompleteBySite[clientRef] ?? [] : []
    return {
      status: 'needs_decision',
      decisionRequest: {
        reason: 'questionnaire_missing',
        message:
          'Il driver Content si misura con il questionario delle Bibbia 9a/9b: nessun template ' +
          'risulta compilato integralmente per il sito cliente. Compila il questionario Content ' +
          '(tutte le domande di almeno un template) e poi rispondi a questa decisione per far ' +
          'ripartire il job.' +
          (clientIncomplete.length > 0
            ? ` Template iniziati ma incompleti: ${clientIncomplete
                .map((t) => `${t.template} (${t.answered}/${t.total})`)
                .join(', ')}.`
            : ''),
        incomplete_templates: clientIncomplete,
      },
      rawPayload: { source: 'questionnaire:9a_9b', answers_seen: answers.length },
    }
  }

  return {
    status: 'done',
    sites: measured,
    rawPayload: {
      source: 'questionnaire:9a_9b',
      note:
        'Score = mean of the fully compiled templates per site (9a). Competitors without a ' +
        'compiled questionnaire are unmeasured — Content is a Development driver, competitor ' +
        'forms are optional.',
      unmeasured: ctx.sites
        .filter((s) => !measured.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      incomplete_by_site: incompleteBySite,
    },
  }
}
