import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client — bypasses RLS.
 *
 * Server-side only. Until now every caller inlined this (14 copies across
 * app/api and lib, two of them reading SUPABASE_URL instead of
 * NEXT_PUBLIC_SUPABASE_URL); the V4 runner needs one definition because a
 * driver job has no user session to borrow.
 *
 * Never import this from a client component.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Supabase admin client not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required',
    )
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
