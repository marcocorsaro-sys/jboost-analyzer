/**
 * V4 — API-key hydration from app_config, ENV-FIRST with a VALIDITY GUARD
 * (fix 13/10, revised 24/10).
 *
 * The admin panel (/admin > Config) stores provider keys in the app_config
 * table. The V4 source modules read process.env directly, so this hydrates
 * the env from app_config before a driver job or an insights run executes —
 * otherwise a key pasted only in the admin UI would be silently ignored.
 *
 * PRECEDENCE: the env wins (the Vercel keys are the fresh ones; stale April
 * rows in app_config used to SHADOW them under the old DB-first order).
 *
 * VALIDITY GUARD (24/10): the first env-first release regressed Ahrefs — the
 * key set in Vercel is answered 401 (rejected) while the April app_config key
 * is accepted by Ahrefs (Authority had measured with it on 11/09). So when
 * BOTH sources hold a value, the two differ, and the provider offers a free
 * "is this key valid" call, the env key is probed first: only if the provider
 * REJECTS it (401/WRONG KEY) does the DB value take over for this invocation.
 * A probe that cannot decide (network error, 5xx) keeps the env key — never
 * guess. Everything stays best-effort: hydration is never load-bearing.
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

export type KeyVerdict = 'valid' | 'rejected' | 'unknown'
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const PROBE_TIMEOUT_MS = 6_000

/**
 * Cheap, free validity probes. `rejected` ONLY on an explicit auth failure;
 * anything inconclusive is `unknown` (the caller then keeps the env key).
 */
export async function probeKey(
  name: string,
  value: string,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<KeyVerdict> {
  try {
    if (name === 'AHREFS_API_KEY') {
      const res = await fetchImpl(
        'https://api.ahrefs.com/v3/subscription-info/limits-and-usage',
        {
          headers: { Authorization: `Bearer ${value}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        },
      )
      if (res.status === 401) return 'rejected'
      return res.ok ? 'valid' : 'unknown'
    }
    if (name === 'SEMRUSH_API_KEY') {
      const res = await fetchImpl(
        `https://www.semrush.com/users/countapiunits.html?key=${encodeURIComponent(value)}`,
        { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
      )
      const text = (await res.text()).trim()
      if (/WRONG KEY|ERROR\s*120|ERROR\s*130/i.test(text)) return 'rejected'
      return res.ok && /^\d+$/.test(text) ? 'valid' : 'unknown'
    }
  } catch {
    return 'unknown'
  }
  return 'unknown'
}

/**
 * Pure decision: which value should be used for one key?
 * `env` / `db` are already trimmed ('' = absent).
 */
export function pickKeyValue(
  env: string,
  db: string,
  envVerdict: KeyVerdict,
): { value: string; source: 'env' | 'db' | 'none' } {
  if (env && db && env !== db && envVerdict === 'rejected') return { value: db, source: 'db' }
  if (env) return { value: env, source: 'env' }
  if (db) return { value: db, source: 'db' }
  return { value: '', source: 'none' }
}

/**
 * Copy the app_config values of the known provider keys into process.env.
 * Env-first; the DB value replaces a differing env value only when the
 * provider explicitly rejects the env key (see header).
 */
export async function hydrateApiKeysFromConfig(
  db: SupabaseClient,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<void> {
  try {
    const { data, error } = await db
      .from('app_config')
      .select('key, value')
      .in('key', [...V4_API_KEYS])
    if (error || !data) return
    for (const row of data) {
      const key = row.key as string
      const envValue = (process.env[key] ?? '').trim()
      const dbValue = typeof row.value === 'string' ? row.value.trim() : ''

      let verdict: KeyVerdict = 'unknown'
      if (envValue && dbValue && envValue !== dbValue) {
        verdict = await probeKey(key, envValue, fetchImpl)
        if (verdict === 'rejected') {
          console.warn(
            `[hydrate-keys] ${key}: the env value was rejected by the provider; using the app_config value for this invocation`,
          )
        }
      }
      const { value, source } = pickKeyValue(envValue, dbValue, verdict)
      if (source === 'db' && value) process.env[key] = value
    }
  } catch {
    // Non-fatal by design: hydration is a convenience layer, never load-bearing.
  }
}
