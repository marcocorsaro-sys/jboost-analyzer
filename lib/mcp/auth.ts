/**
 * MCP connector — request authentication helpers (pure where possible).
 *
 * Flow (MCP authorization spec, 2025-06-18): the client POSTs to /api/mcp
 * without a token → 401 + `WWW-Authenticate: Bearer resource_metadata=…` →
 * the client reads our protected-resource metadata, which names the Supabase
 * OAuth server as authorization server → dynamic registration / authorize
 * (our /oauth/consent page) / token → the client retries with the Supabase
 * access token. We verify it against Supabase Auth on EVERY request (no JWT
 * secret to manage, revocation honoured) and then run the tools as that user.
 */

/** The bearer token of a request, if it carries one. */
export function bearerTokenFromHeader(value: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec((value ?? '').trim())
  return match ? match[1] : null
}

/** Public origin from request headers (works for Request and next/headers). */
export function originFromHeaders(headers: Pick<Headers, 'get'>, fallbackUrl?: string): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  if (env) return env
  const forwardedHost = headers.get('x-forwarded-host') ?? headers.get('host')
  const forwardedProto = headers.get('x-forwarded-proto') ?? (forwardedHost?.startsWith('localhost') ? 'http' : 'https')
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`
  try {
    return fallbackUrl ? new URL(fallbackUrl).origin : 'http://localhost:3000'
  } catch {
    return 'http://localhost:3000'
  }
}

/** Public origin of this deployment, for metadata URLs and in-process routes. */
export function publicOrigin(request: Request): string {
  return originFromHeaders(request.headers, request.url)
}

/** URL of the MCP endpoint itself (what people paste into Claude). */
export function mcpEndpointUrl(origin: string): string {
  return `${origin}/api/mcp`
}

/** RFC 9728 metadata URL for our MCP resource. */
export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/api/mcp`
}

/** The 401 challenge that starts the client's OAuth discovery. */
export function wwwAuthenticate(origin: string, error?: 'invalid_token'): string {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl(origin)}"`]
  if (error) parts.unshift(`error="${error}"`)
  return `Bearer ${parts.join(', ')}`
}

/** Supabase Auth base URL (the OAuth authorization server's issuer). */
export function supabaseAuthIssuer(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, '')
  return url ? `${url}/auth/v1` : null
}

/** RFC 9728 document served at /.well-known/oauth-protected-resource[/api/mcp]. */
export function protectedResourceMetadata(origin: string) {
  const issuer = supabaseAuthIssuer()
  return {
    resource: mcpEndpointUrl(origin),
    authorization_servers: issuer ? [issuer] : [],
    bearer_methods_supported: ['header'],
    resource_name: 'J-Boost Analyzer',
    // Scopes are Supabase's; the connector itself needs no extra scope.
    scopes_supported: ['openid', 'email', 'profile'],
  }
}

export interface McpPrincipal {
  userId: string
  email: string | null
  /** OAuth client that obtained the token (Supabase `client_id` claim), if any. */
  clientId: string | null
}

/** Reads the (already verified) claims of a JWT for display/audit only. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1]
    if (!payload) return {}
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Verify an access token with Supabase Auth. Null = not valid (expired,
 * revoked, malformed). A network failure also yields null: failing closed.
 */
export async function verifyAccessToken(token: string): Promise<McpPrincipal | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  try {
    // Lazy: keeps the pure helpers above importable without the Supabase SDK.
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
    const supabase = createSupabaseClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) return null
    const clientId = jwtClaims(token).client_id
    return {
      userId: data.user.id,
      email: data.user.email ?? null,
      clientId: typeof clientId === 'string' ? clientId : null,
    }
  } catch {
    return null
  }
}
