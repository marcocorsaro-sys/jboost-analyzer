/**
 * V4 Content driver — pure scoring engine (Bibbia sheet 9a).
 *
 * template_score: the 9a formula is "sum of selected points" with "Max per
 * template = 100". The Article template breaks that premise in the source
 * (its max points sum to 85 — see lib/v4/content/bank.ts header), so per
 * project decision (2026-08-11) the score is computed as
 *
 *   score = round(100 * sum(points) / sum(max points of the template), 1)
 *
 * For the eight consistent templates (max = 100) this is IDENTICAL to the
 * plain sum; for Article it absorbs the anomaly instead of capping every
 * site at 85 for a spreadsheet inconsistency.
 *
 * overall_content_score: mean of the COMPILED templates only (9a rule:
 * "Templates not present on the site are EXCLUDED from the calc — not
 * scored as 0"). An empty set is null, never 0: 0 is a measurement
 * ("everything is very bad"), null is the absence of one.
 *
 * Completeness is strict: a template with any unanswered question is not
 * scorable and raises an explicit error. Treating a missing answer as A/0
 * would silently turn "not assessed" into "very bad" — the exact class of
 * bug (absence written as a real measurement) the V4 spec exists to kill.
 */

import type { ContentAnswerKey, ContentQuestion } from './bank'
import { getContentTemplate } from './bank'

/** 9a "Score interpretation" bands. */
export type ContentBand = 'Critical' | 'Weak' | 'Good' | 'Excellent'

export class ContentScoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentScoreError'
  }
}

export interface PerQuestionScore {
  questionId: number
  area: string
  weight: number
  selected: ContentAnswerKey
  points: number
  maxPoints: number
}

export interface TemplateScoreResult {
  templateKey: string
  /** 0-100, one decimal. */
  score: number
  /** Sum of the selected answers' points. */
  points: number
  /** Sum of the template's D-answer points (100 everywhere except Article: 85). */
  maxPoints: number
  perQuestion: PerQuestionScore[]
}

const ANSWER_KEYS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D'])

function questionMax(q: ContentQuestion): number {
  return Math.max(...q.answers.map((a) => a.points))
}

/**
 * Score ONE template of ONE site from a complete answer set.
 * Throws ContentScoreError on an unknown template, a missing answer or an
 * invalid answer key — never returns a score built on absent data.
 */
export function templateScore(
  templateKey: string,
  answers: Record<string | number, ContentAnswerKey | string | null | undefined>,
): TemplateScoreResult {
  const template = getContentTemplate(templateKey)
  if (!template) {
    throw new ContentScoreError(`unknown content template "${templateKey}"`)
  }

  const perQuestion: PerQuestionScore[] = []
  const missing: number[] = []

  for (const q of template.questions) {
    const selected = answers[q.id] ?? answers[String(q.id)]
    if (selected === null || selected === undefined || selected === '') {
      missing.push(q.id)
      continue
    }
    if (typeof selected !== 'string' || !ANSWER_KEYS.has(selected)) {
      throw new ContentScoreError(
        `invalid answer "${String(selected)}" for template "${templateKey}" question ${q.id} (expected A-D)`,
      )
    }
    const option = q.answers.find((a) => a.key === selected)
    if (!option) {
      throw new ContentScoreError(
        `template "${templateKey}" question ${q.id} has no answer "${selected}"`,
      )
    }
    perQuestion.push({
      questionId: q.id,
      area: q.area,
      weight: q.weight,
      selected: option.key,
      points: option.points,
      maxPoints: questionMax(q),
    })
  }

  if (missing.length > 0) {
    throw new ContentScoreError(
      `template "${templateKey}" is not fully answered: missing question(s) ${missing.join(', ')}. ` +
        'An incomplete questionnaire cannot be scored (a missing answer is not a 0).',
    )
  }

  const points = perQuestion.reduce((sum, q) => sum + q.points, 0)
  const maxPoints = perQuestion.reduce((sum, q) => sum + q.maxPoints, 0)

  return {
    templateKey: template.key,
    score: round1((100 * points) / maxPoints),
    points,
    maxPoints,
    perQuestion,
  }
}

/**
 * Overall Content score of one site: mean of the compiled templates' scores,
 * one decimal. No compiled template -> null, NEVER 0 (9a: templates not
 * present are excluded, not scored).
 */
export function overallContent(templateScores: number[]): number | null {
  if (templateScores.length === 0) return null
  const sum = templateScores.reduce((a, b) => a + b, 0)
  return round1(sum / templateScores.length)
}

/** 9a interpretation bands: 0-39 / 40-59 / 60-79 / 80-100. */
export function band(score: number): ContentBand {
  if (score < 40) return 'Critical'
  if (score < 60) return 'Weak'
  if (score < 80) return 'Good'
  return 'Excellent'
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
