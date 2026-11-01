import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'

import { bearerTokenFromHeader } from '@/lib/mcp/auth'

/**
 * Bearer-token client (MCP connector). A request that carries
 * `Authorization: Bearer <supabase access token>` — the OAuth token Claude got
 * through the Supabase OAuth server — authenticates as THAT user: the client
 * sends the token to PostgREST, so RLS evaluates against the caller exactly
 * like a cookie session would.
 *
 * `auth.getUser()` with no argument reads the stored session, and this client
 * has none (persistSession off), so it is bound to the token: every route that
 * does `supabase.auth.getUser()` keeps working unchanged.
 */
export function createBearerClient(token: string): SupabaseClient {
  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  )
  const getUser = client.auth.getUser.bind(client.auth)
  client.auth.getUser = ((jwt?: string) => getUser(jwt ?? token)) as typeof client.auth.getUser
  return client
}

export async function createClient() {
  // MCP / API callers: a bearer token wins over cookies (browsers never send
  // an Authorization header to our own routes, so web sessions are untouched).
  try {
    const token = bearerTokenFromHeader((await headers()).get('authorization'))
    if (token) return createBearerClient(token) as unknown as ReturnType<typeof createServerClient>
  } catch {
    // headers() is unavailable outside a request scope — fall through to cookies.
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
  )
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
