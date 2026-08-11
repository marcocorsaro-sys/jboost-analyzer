/**
 * V4 driver — AI Visibility (paste-driven, Bibbia sheet 7 row 7).
 *
 * There is no API. The flow is the Bibbia's paste-driven loop (sheets 3, 7):
 * the first run PAUSES with a ready-made copy-prompt; the operator pastes it
 * into the J-Horizon chatbot and pastes the answer back; one LLM call then
 * extracts the GEO scores (client + competitors) and writes both comments
 * (lib/v4/drivers/jhorizon-extract.ts).
 *
 * It runs through the runner rather than sitting outside it, because the job
 * table already models exactly this: `needs_decision` is a job that cannot
 * proceed without a human, and `decision_taken` is what the human answered.
 * Modelling the paste as a pause means it shows up in the same progress view,
 * blocks completion the same way, and gets the same audit trail as everything
 * else — instead of being a special case nobody sees.
 *
 * The extracted scores stay operator-editable (sheet 17 "AI Visibility
 * competitors"): a decision carrying explicit numbers ({score, competitors})
 * is always honoured as-is, with NO LLM call. Partial J-Horizon coverage of
 * the competitor set is expected — an uncovered competitor stays unmeasured,
 * never 0. An answer that does not cover the CLIENT pauses again: without
 * the client there is nothing to score.
 */

import type { DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { buildJhorizonPrompt, extractGeoScores } from './jhorizon-extract'

export interface AiVisibilityDecision {
  /** 0-100, typed by the operator from the J-Horizon report. */
  score: number
  comment?: string | null
  /** Optional per-competitor scores, same 0-100 scale. */
  competitors?: Record<string, number>
}

/** Pure: validate an explicit manual override ({score, competitors}). */
export function parseAiVisibilityDecision(
  taken: Record<string, unknown> | null | undefined,
): { decision: AiVisibilityDecision | null; error: string | null } {
  if (!taken || taken.score === undefined || taken.score === null) {
    return { decision: null, error: null }
  }

  const score = Number(taken.score)
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return { decision: null, error: `punteggio AI Visibility non valido: ${String(taken.score)} (atteso 0-100)` }
  }

  const competitors: Record<string, number> = {}
  const raw = taken.competitors
  if (raw && typeof raw === 'object') {
    for (const [domain, value] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return { decision: null, error: `punteggio AI Visibility non valido per ${domain}: ${String(value)}` }
      }
      competitors[domain.toLowerCase()] = n
    }
  }

  return {
    decision: {
      score,
      comment: typeof taken.comment === 'string' ? taken.comment : null,
      competitors,
    },
    error: null,
  }
}

/** The pause payload: copy-prompt + both input paths (paste or manual). */
function pauseRequest(
  ctx: Parameters<DriverWorker>[0],
  reason: 'jhorizon_paste' | 'client_not_covered',
  message: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    reason,
    copy_prompt: buildJhorizonPrompt(ctx.sites),
    message,
    fields: [
      { key: 'jhorizon_answer', label: 'Risposta J-Horizon (incolla qui)', type: 'text', required: false },
      { key: 'score', label: 'Punteggio cliente 0-100 (inserimento manuale)', type: 'number', required: false },
      {
        key: 'competitors',
        label: 'Punteggi competitor (manuali, opzionali)',
        type: 'map',
        domains: ctx.sites.filter((s) => !s.is_client).map((s) => s.domain),
      },
    ],
    ...extra,
  }
}

export const aiVisibilityWorker: DriverWorker = async (ctx) => {
  // -- 1. Manual override: explicit numbers, NO LLM call ---------------------
  // The operator can always type the scores directly (spec: extracted scores
  // are editable). This is also the pre-paste-flow format, kept valid.
  if (ctx.decisionTaken && ctx.decisionTaken.score !== undefined && ctx.decisionTaken.score !== null) {
    const { decision, error } = parseAiVisibilityDecision(ctx.decisionTaken)
    if (error || !decision) {
      return {
        status: 'error',
        error: error ?? 'decisione AI Visibility non valida',
        rawPayload: { submitted: ctx.decisionTaken },
      }
    }

    // Only the sites the operator actually gave a number for are scored. A
    // competitor left blank stays unmeasured — writing 0 would claim we know
    // it has no AI visibility, which we do not.
    const sites: SiteRawValue[] = []
    for (const site of ctx.sites) {
      const value = site.is_client ? decision.score : decision.competitors?.[site.domain.toLowerCase()]
      if (value === undefined) continue
      sites.push({
        site_ref: site.site_ref,
        domain: site.domain,
        raw: value,
        score_absolute: Math.round(value),
        evidence: { method: 'manual', source: 'J-Horizon', comment: decision.comment },
      })
    }

    return {
      status: 'done',
      sites,
      rawPayload: {
        source: 'j-horizon:manual',
        method: 'manual',
        comment: decision.comment,
        unmeasured: ctx.sites
          .filter((s) => !sites.some((m) => m.site_ref === s.site_ref))
          .map((s) => s.domain),
      },
    }
  }

  // -- 2. Pasted J-Horizon answer: one LLM extraction call -------------------
  const pasted =
    typeof ctx.decisionTaken?.jhorizon_answer === 'string' ? ctx.decisionTaken.jhorizon_answer.trim() : ''

  if (pasted) {
    let extraction
    try {
      const result = await extractGeoScores(pasted, ctx.sites)
      if (result.error || !result.extraction) {
        return {
          status: 'error',
          error: result.error ?? 'estrazione J-Horizon fallita',
          rawPayload: { source: 'j-horizon:paste', jhorizon_answer_length: pasted.length },
        }
      }
      extraction = result.extraction
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        rawPayload: { source: 'j-horizon:paste', jhorizon_answer_length: pasted.length },
      }
    }

    const scoreByRef = new Map(extraction.scores.map((s) => [s.site_ref, s.geo_score]))
    const clientRef = ctx.sites.find((s) => s.is_client)?.site_ref

    // The client is the one site the driver cannot do without: a paste that
    // does not cover it is not a measurement, so pause again instead of
    // scoring competitors around a hole.
    if (clientRef === undefined || scoreByRef.get(clientRef) == null) {
      return {
        status: 'needs_decision',
        decisionRequest: pauseRequest(
          ctx,
          'client_not_covered',
          'La risposta J-Horizon incollata non copre il sito cliente, quindi non è stato possibile ' +
            'estrarre il suo GEO Score. Reincolla una risposta che includa il cliente oppure inserisci ' +
            'il punteggio manualmente (0-100).',
          { extracted_scores: extraction.scores },
        ),
        rawPayload: { source: 'j-horizon:paste', jhorizon_answer_length: pasted.length },
      }
    }

    // A competitor the answer does not cover stays unmeasured — expected with
    // partial J-Horizon coverage (sheet 17), never coerced to 0.
    const sites: SiteRawValue[] = []
    for (const site of ctx.sites) {
      const geo = scoreByRef.get(site.site_ref)
      if (geo == null) continue
      const evidence: Record<string, unknown> = {
        method: 'paste-driven',
        source: 'J-Horizon',
        jhorizon_answer_length: pasted.length,
      }
      if (site.is_client) {
        evidence.comment_absolute = extraction.comment_absolute
        evidence.comment_relative = extraction.comment_relative
      }
      sites.push({
        site_ref: site.site_ref,
        domain: site.domain,
        // The only Business driver with an Absolute view: raw IS the GEO
        // score, so score_absolute is just its rounding.
        raw: geo,
        score_absolute: Math.round(geo),
        evidence,
      })
    }

    return {
      status: 'done',
      sites,
      rawPayload: {
        source: 'j-horizon:paste',
        method: 'paste-driven',
        // Kept for the future Executive Summary (Bibbia sheet 16: the paste
        // step's relative comment feeds the cross-driver context).
        comment_absolute: extraction.comment_absolute,
        comment_relative: extraction.comment_relative,
        jhorizon_answer_length: pasted.length,
        unmeasured: ctx.sites
          .filter((s) => !sites.some((m) => m.site_ref === s.site_ref))
          .map((s) => s.domain),
      },
    }
  }

  // -- 3. First run: pause with the copy-prompt ------------------------------
  return {
    status: 'needs_decision',
    decisionRequest: pauseRequest(
      ctx,
      'jhorizon_paste',
      'AI Visibility segue il flusso paste-driven: copia il prompt qui sotto, incollalo nel chatbot ' +
        'J-Horizon e incolla qui la risposta completa (cliente + competitor). In alternativa puoi ' +
        'inserire manualmente i punteggi GEO 0-100.',
    ),
    rawPayload: { source: 'j-horizon:paste' },
  }
}
