// Helpers for MCP tools to call the app's own API routes (and Supabase),
// forwarding the caller's bearer token so RLS + spend limits + activity
// logging all run under the authenticated user — no logic is duplicated.

/**
 * Resolves the base URL the MCP tools use to reach the app's own routes.
 * Order of precedence:
 *   1. MCP_PUBLIC_BASE_URL  — explicit override (recommended in production)
 *   2. NEXT_PUBLIC_SITE_URL — the app's canonical public URL, if set
 *   3. VERCEL_URL           — auto-injected on Vercel deployments
 *   4. http://localhost:3000 — local dev fallback
 */
export function appBaseUrl(): string {
  const explicit = process.env.MCP_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export interface ApiResult {
  ok: boolean
  status: number
  body: unknown
}

/**
 * Calls an internal API route, forwarding the caller's bearer token. Because
 * `lib/supabase/server.createClient()` is bearer-aware, the target route
 * authenticates the request as the same user.
 */
export async function apiFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<ApiResult> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)

  const res = await fetch(`${appBaseUrl()}${path}`, { ...init, headers })

  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  return { ok: res.ok, status: res.status, body }
}

/** Convenience JSON POST helper. */
export function postJson(
  token: string,
  path: string,
  payload: unknown
): Promise<ApiResult> {
  return apiFetch(token, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

// ── MCP tool result shaping ────────────────────────────────────────────────

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** Wraps a successful payload as an MCP text result. */
export function toolOk(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

/** Wraps an error as an MCP error result. */
export function toolError(message: string, details?: unknown): ToolResult {
  const text = details !== undefined ? `${message}: ${JSON.stringify(details)}` : message
  return { content: [{ type: 'text', text }], isError: true }
}

/** Turns an ApiResult into a tool result, treating non-2xx as an error. */
export function fromApi(result: ApiResult): ToolResult {
  if (!result.ok) {
    return toolError(`API call failed (HTTP ${result.status})`, result.body)
  }
  return toolOk(result.body)
}
