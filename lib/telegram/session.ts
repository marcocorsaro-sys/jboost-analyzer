/**
 * Telegram bot — short-lived Supabase access token for a linked JBA user.
 *
 * The bot has no browser login. For a user who linked their Telegram account
 * (proved by a code generated while signed in to JBA), the server asks Supabase
 * Auth (service role) for a one-time magic-link hash — nothing is emailed —
 * and exchanges it for a normal 1-hour session. The token is then used exactly
 * like the Claude connector's, so RLS applies to that person and nobody else.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

export async function mintAccessToken(email: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon || !email) return null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const hash = data?.properties?.hashed_token
    if (error || !hash) return null
    const anonClient = createSupabaseClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data: verified, error: verifyError } = await anonClient.auth.verifyOtp({ type: 'magiclink', token_hash: hash })
    if (verifyError) return null
    return verified.session?.access_token ?? null
  } catch {
    return null
  }
}
