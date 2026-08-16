/**
 * Settings — connector presence + V4 defaults (UX-UI Bibbia 04,
 * "Navigation & Screens": Settings = "APIs / data sources / preferences").
 *
 * Presence ONLY: this module answers "is the key configured, and from
 * where?" and never exposes a single character of any credential. Full
 * health probes (live calls, latency, quotas) stay in the admin panel
 * (lib/admin/integration-probes) — Settings links there.
 *
 * Key resolution uses the exact precedence of the admin probes and of
 * run-analysis: app_config row wins over env var.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DEFAULT_DRIVER_MODEL,
  DEFAULT_SUMMARY_MODEL,
} from '@/lib/v4/llm/prompts'
import { DEFAULT_LIMIT_EUR } from '@/lib/tracking/spend-limit'

/** The data-source keys the V4 one-off flow depends on (Bibbia 04, setup sheet). */
export const SETTINGS_CONNECTOR_KEYS = [
  'AHREFS_API_KEY',
  'SEMRUSH_API_KEY',
  'GOOGLE_PSI_API_KEY',
  'FIRECRAWL_API_KEY',
  'ANTHROPIC_API_KEY',
  'SIMILARWEB_API_KEY',
] as const
export type ConnectorKey = (typeof SETTINGS_CONNECTOR_KEYS)[number]

export interface ConnectorStatus {
  key: ConnectorKey
  configured: boolean
  /** Where the key was found. Never the value itself. */
  source: 'db' | 'env' | null
}

export interface V4Defaults {
  daily_spend_limit_eur: string
  v4_llm_driver_model: string
  v4_llm_summary_model: string
  /** Which of the three came from app_config vs. built-in default. */
  sources: Record<'daily_spend_limit_eur' | 'v4_llm_driver_model' | 'v4_llm_summary_model', 'db' | 'default'>
}

const DEFAULTS_KEYS = [
  'daily_spend_limit_eur',
  'v4_llm_driver_model',
  'v4_llm_summary_model',
] as const

/**
 * One app_config read feeds both sections. RLS applies through the caller's
 * client; on failure we degrade to env-only presence rather than erroring
 * the whole Settings page.
 */
export async function getSettingsInventory(db: SupabaseClient): Promise<{
  connectors: ConnectorStatus[]
  defaults: V4Defaults
}> {
  let cfg: Record<string, string> = {}
  try {
    const { data } = await db
      .from('app_config')
      .select('key, value')
      .in('key', [...SETTINGS_CONNECTOR_KEYS, ...DEFAULTS_KEYS])
    for (const row of (data ?? []) as Array<{ key: string; value: string }>) {
      if (row.value) cfg[row.key] = row.value
    }
  } catch {
    cfg = {}
  }

  const connectors: ConnectorStatus[] = SETTINGS_CONNECTOR_KEYS.map((key) => {
    // db wins over env — the same precedence the runners use.
    if (cfg[key]) return { key, configured: true, source: 'db' }
    const envVal = process.env[key]
    if (typeof envVal === 'string' && envVal.length > 0) {
      return { key, configured: true, source: 'env' }
    }
    return { key, configured: false, source: null }
  })

  const defaults: V4Defaults = {
    daily_spend_limit_eur: cfg.daily_spend_limit_eur ?? String(DEFAULT_LIMIT_EUR),
    v4_llm_driver_model: cfg.v4_llm_driver_model ?? DEFAULT_DRIVER_MODEL,
    v4_llm_summary_model: cfg.v4_llm_summary_model ?? DEFAULT_SUMMARY_MODEL,
    sources: {
      daily_spend_limit_eur: cfg.daily_spend_limit_eur ? 'db' : 'default',
      v4_llm_driver_model: cfg.v4_llm_driver_model ? 'db' : 'default',
      v4_llm_summary_model: cfg.v4_llm_summary_model ? 'db' : 'default',
    },
  }

  return { connectors, defaults }
}
