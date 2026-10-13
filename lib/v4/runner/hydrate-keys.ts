/**
 * V4 — API-key hydration from app_config, ENV-FIRST (fix 13/10).
 *
 * The admin panel (/admin > Config) stores provider keys in the app_config
 * table. The V4 source modules read process.env directly, so this hydrates
 * the env from app_config before a driver job or an insights run executes —
 * otherwise a key pasted only in the admin UI would be silently ignored
 * (first live run: Ahrefs/PSI/Semrush "not configured" while the keys sat
 * in app_config since April).
 *
 * PRECEDENCE: the env WINS. app_config still holds Semrush/Ahrefs keys
 * pasted in April that are now stale; with the old DB-first precedence they
 * SHADOWED the fresh keys set in the Vercel env (the Compliance failures of
 * the 13/10 feedback), and deleting the DB rows is not practicable today.
 * So: a non-empty process.env value is never overwritten; the DB remains
 * the fallback for keys absent from the env. Per-invocation mutation of
 * process.env is safe on serverless (each invocation is its own process);
 * the source modules stay env-only and dependency-free.
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
 * Copy the app_config values of the known provider keys into process.env,
 * ONLY for keys the env does not already set (env-first — see header).
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
      const key = row.key as string
      // Env-first: a non-empty env value is the fresh one and must never be
      // shadowed by a stale app_config row.
      const envValue = process.env[key]
      if (typeof envValue === 'string' && envValue.trim() !== '') continue
      const value = typeof row.value === 'string' ? row.value.trim() : ''
      if (value) process.env[key] = value
    }
  } catch {
    // Non-fatal by design: hydration is a convenience layer, never load-bearing.
  }
}
