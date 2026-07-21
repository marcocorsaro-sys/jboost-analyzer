/**
 * V4 driver — AI Visibility.
 *
 * There is no API. The score comes from J-Horizon and is typed in by the
 * operator (spec: "manuale da J-Horizon, NON processato da LLM"), so this
 * driver is not a measurement at all — it is a hand-off.
 *
 * It still runs through the runner rather than sitting outside it, because
 * the job table already models exactly this: `needs_decision` is a job that
 * cannot proceed without a human, and `decision_taken` is what the human
 * answered. Modelling the manual driver as a pause means it shows up in the
 * same progress view, blocks completion the same way, and gets the same audit
 * trail as everything else — instead of being a special case nobody sees.
 */

import type { DriverWorker } from '@/lib/v4/runner/types'

export interface AiVisibilityDecision {
  /** 0-100, typed by the operator from the J-Horizon report. */
  score: number
  comment?: string | null
  /** Optional per-competitor scores, same 0-100 scale. */
  competitors?: Record<string, number>
}

/** Pure: validate what the operator submitted. */
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

export const aiVisibilityWorker: DriverWorker = async (ctx) => {
  const { decision, error } = parseAiVisibilityDecision(ctx.decisionTaken)

  if (error) {
    return { status: 'error', error, rawPayload: { submitted: ctx.decisionTaken } }
  }

  if (!decision) {
    return {
      status: 'needs_decision',
      decisionRequest: {
        reason: 'manual_input',
        message:
          'AI Visibility non ha una fonte automatica: inserisci il punteggio 0-100 letto su J-Horizon ' +
          'per il cliente (e, se disponibili, per i competitor).',
        fields: [
          { key: 'score', label: 'Punteggio cliente (0-100)', type: 'number', required: true },
          { key: 'comment', label: 'Commento', type: 'text', required: false },
          {
            key: 'competitors',
            label: 'Punteggi competitor (opzionali)',
            type: 'map',
            domains: ctx.sites.filter((s) => !s.is_client).map((s) => s.domain),
          },
        ],
      },
      rawPayload: { source: 'j-horizon:manual' },
    }
  }

  // Only the sites the operator actually gave a number for are scored. A
  // competitor left blank stays unmeasured — writing 0 would claim we know
  // it has no AI visibility, which we do not.
  const sites = ctx.sites
    .map((site) => {
      const value = site.is_client ? decision.score : decision.competitors?.[site.domain.toLowerCase()]
      if (value === undefined) return null
      return {
        site_ref: site.site_ref,
        domain: site.domain,
        raw: value,
        score_absolute: Math.round(value),
        evidence: { entered_manually: true, source: 'J-Horizon', comment: decision.comment },
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  return {
    status: 'done',
    sites,
    rawPayload: {
      source: 'j-horizon:manual',
      comment: decision.comment,
      unmeasured: ctx.sites
        .filter((s) => !sites.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
    },
  }
}
