import { createClient } from '@supabase/supabase-js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

/**
 * Verifies the bearer token presented by an MCP client.
 *
 * The token must be a valid Supabase access token (JWT). We validate it
 * against Supabase Auth (GoTrue) and, on success, return an AuthInfo whose
 * `token` is forwarded to every tool call. Tools re-use that token to talk to
 * the app's own API routes, so the entire request chain runs under the
 * caller's identity with RLS enforced — there is no service-role escalation.
 *
 * Returning `undefined` makes mcp-handler reject the request with 401.
 */
export async function verifySupabaseToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    console.error('[mcp/auth] Supabase env vars are not configured')
    return undefined
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase.auth.getUser(bearerToken)
  if (error || !data?.user) return undefined

  return {
    token: bearerToken,
    clientId: data.user.id,
    scopes: ['jboost:full'],
    extra: {
      userId: data.user.id,
      email: data.user.email ?? null,
    },
  }
}
