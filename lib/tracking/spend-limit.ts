/**
 * Daily LLM spend limit — global across all users.
 *
 * The cap is read from `app_config.daily_spend_limit_eur` (default €10). When
 * today's aggregate spend on `llm_usage` reaches the cap, every LLM-calling
 * route returns HTTP 402 with a clear message. The dashboard surfaces a
 * banner at 80% and a hard block at 100%.
 *
 * Cost on legacy rows where `estimated_cost_usd = 0` (model ID not yet in
 * the pricing dict at the time of insert) is recomputed on the fly so the
 * limit can't be bypassed by an unknown-model loophole.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { estimateCost } from './pricing'

export const DEFAULT_LIMIT_EUR = 10
export const DEFAULT_USD_TO_EUR = 0.92
const NEAR_LIMIT_RATIO = 0.8

export interface SpendStatus {
  spentTodayUsd: number
  spentTodayEur: number
  limitEur: number
  remainingEur: number
  usdToEur: number
  ratio: number
  blocked: boolean
  nearLimit: boolean
}

interface UsageRow {
  estimated_cost_usd: number | string | null
  input_tokens: number | null
  output_tokens: number | null
  model: string | null
}

function startOfTodayUtcIso(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  return new Date(Date.UTC(y, m, d, 0, 0, 0)).toISOString()
}

/** Pull today's spend + the configured limit + EUR conversion in parallel. */
export async function getSpendStatus(
  supabase?: SupabaseClient,
): Promise<SpendStatus> {
  const sb = supabase ?? (await createClient())
  const since = startOfTodayUtcIso()
  const [{ data: cfgRows }, { data: usageRows }] = await Promise.all([
    sb.from('app_config').select('key, value').in('key', ['daily_spend_limit_eur', 'usd_to_eur_rate']),
    sb
      .from('llm_usage')
      .select('estimated_cost_usd, input_tokens, output_tokens, model')
      .gte('created_at', since),
  ])

  const cfg = Object.fromEntries(((cfgRows ?? []) as { key: string; value: string }[]).map(r => [r.key, r.value]))
  const limitEur = Number(cfg.daily_spend_limit_eur ?? DEFAULT_LIMIT_EUR) || DEFAULT_LIMIT_EUR
  const usdToEur = Number(cfg.usd_to_eur_rate ?? DEFAULT_USD_TO_EUR) || DEFAULT_USD_TO_EUR

  const spentUsd = ((usageRows ?? []) as UsageRow[]).reduce((acc, row) => {
    const stored = Number(row.estimated_cost_usd) || 0
    if (stored > 0) return acc + stored
    // Backfill on the fly for rows where the model wasn't in the pricing dict
    // at insert time (e.g. legacy schema_radiography_v1 entries pre-fix).
    return acc + estimateCost(row.model ?? '', row.input_tokens ?? 0, row.output_tokens ?? 0)
  }, 0)

  const spentEur = spentUsd * usdToEur
  const ratio = limitEur > 0 ? spentEur / limitEur : 0

  return {
    spentTodayUsd: spentUsd,
    spentTodayEur: spentEur,
    limitEur,
    remainingEur: Math.max(0, limitEur - spentEur),
    usdToEur,
    ratio,
    blocked: spentEur >= limitEur,
    nearLimit: ratio >= NEAR_LIMIT_RATIO,
  }
}

/**
 * Use at the top of every LLM-calling route. Returns a 402 NextResponse if
 * the daily limit is reached, otherwise null. Pass the same supabase client
 * you already created in the handler to avoid creating a second one.
 */
export async function enforceSpendLimit(
  supabase?: SupabaseClient,
): Promise<NextResponse | null> {
  const status = await getSpendStatus(supabase)
  if (!status.blocked) return null
  return NextResponse.json(
    {
      error: `Limite di spesa LLM giornaliero raggiunto (€${status.limitEur.toFixed(2)}/giorno). Contatta l'admin per aumentare il limite.`,
      spendStatus: status,
    },
    { status: 402 },
  )
}
