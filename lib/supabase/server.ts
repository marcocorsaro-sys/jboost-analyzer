import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'

// Reads `Authorization: Bearer <jwt>` from the current request, if present.
// External callers (e.g. the MCP server at /api/mcp, or any programmatic API
// consumer) authenticate with a Supabase JWT instead of a browser cookie
// session. Returns the raw token or null.
async function getBearerToken(): Promise<string | null> {
  try {
    const h = await headers()
    const auth = h.get('authorization')
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      const token = auth.slice(7).trim()
      return token.length > 0 ? token : null
    }
  } catch {
    // headers() is unavailable outside a request scope — fall through to cookies.
  }
  return null
}

// Returns a request-scoped Supabase client. Two authentication modes:
//
//  1. Bearer mode — when the request carries `Authorization: Bearer <jwt>`
//     (external / MCP / programmatic callers). The client runs under that
//     user's JWT, so RLS applies exactly as for a browser session.
//  2. Cookie mode — the default for browser-driven requests (server
//     components, route handlers reached from the dashboard).
//
// Both branches return a structurally identical SupabaseClient, so every
// existing API route keeps working unchanged while also becoming callable
// from outside with a bearer token.
export async function createClient(): Promise<SupabaseClient> {
  const bearer = await getBearerToken()

  if (bearer) {
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
        // PostgREST queries run under the caller's JWT → RLS enforced per-user.
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      }
    )
    // Establish the session so that `auth.getUser()` (no-arg, as every route
    // calls it) resolves the authenticated user. setSession validates the
    // token against GoTrue; an invalid/expired token leaves the client
    // unauthenticated and routes return 401, same as a missing cookie.
    await supabase.auth.setSession({ access_token: bearer, refresh_token: bearer })
    return supabase
  }

  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: any) {
          try {
            cookiesToSet.forEach(({ name, value, options }: any) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  ) as unknown as SupabaseClient
}

// Request-scoped memoization: layouts and pages in the same render both need
// the authenticated user, but each `auth.getUser()` is a network round-trip to
// Supabase Auth. `cache()` collapses repeat calls within one request to one.
export const getUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

// Same idea for the client row, which the client-detail layout and its page
// both load by id.
export const getClientById = cache(async (id: string) => {
  const supabase = await createClient()
  const { data } = await supabase.from('clients').select('*').eq('id', id).single()
  return data
})

// Request-scoped role lookup. The dashboard layout + several server pages
// each independently check whether the current user is admin; without this,
// every navigation pays for the profile fetch twice (layout + page).
export const getProfileRole = cache(async (userId: string): Promise<string | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()
  return (data?.role as string | null) ?? null
})
