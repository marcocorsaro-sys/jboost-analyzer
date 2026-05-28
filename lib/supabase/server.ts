import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'

export async function createClient() {
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
