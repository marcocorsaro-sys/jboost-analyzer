/**
 * V4 — API-key hydration from app_config.
 *
 * The admin panel (/admin > Config) stores provider keys in the app_config
 * table, and V1's run-analysis resolves keys DB-first (dbKeys[...] ||
 * process.env). The V4 source modules read process.env directly — correct in
 * isolation, but it silently ignores every key the user pasted into the
 * admin UI. First live run: Ahrefs/PSI/Semrush all "not configured" while
 * the keys sat in app_config since April.
 *
 * This hydrates process.env from app_config before a driver job or an
 * insights run executes, with the SAME precedence as V1 and the admin
 * probes: a non-empty DB value wins over the env. Per-invocation mutation
 * of process.env is safe on serverless (each invocation is its own
 * process); the source modules stay env-only and dependency-free.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Every provider key a V4 worker or the LLM orchestrator may need. */
export const V4_API_KEYS = [
  'AHREFS_API_KEY',
  'SEMRUSH_API_KEY',
  'GOOGLE_PSI_API_KEY',
  'FIRECRAWL_API_KEY',
  'SIMILARWEB_API_KEY',
  'ANTHROPIC_API_KEY',
] as const

/**
 * Copy the app_config values of the known provider keys into process.env.
 * Best-effort: a failed read leaves the env as-is (the worker will then
 * report the missing key explicitly, which is the honest fallback).
 */
export async function hydrateApiKeysFromConfig(db: SupabaseClient): Promise<void> {
  try {
    const { data, error } = await db
      .from('app_config')
      .select('key, value')
      .in('key', [...V4_API_KEYS])
    if (error || !data) return
    for (const row of data) {
      const value = typeof row.value === 'string' ? row.value.trim() : ''
      if (value) process.env[row.key as string] = value
    }
  } catch {
    // Non-fatal by design: hydration is a convenience layer, never load-bearing.
  }
}
