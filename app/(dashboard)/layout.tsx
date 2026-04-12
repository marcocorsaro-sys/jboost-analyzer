import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { LocaleProvider, isValidLocale, type Locale } from '@/lib/i18n'
import { Shell } from '@/components/layout/shell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Read locale from cookie — no flash of English
  const cookieStore = await cookies()
  const rawLocale = cookieStore.get('jboost-locale')?.value
  const cookieLocale: Locale = isValidLocale(rawLocale) ? rawLocale : 'en'

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let isAdmin = false

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    isAdmin = profile?.role === 'admin'
  }

  return (
    <LocaleProvider initialLocale={cookieLocale}>
      <Shell userEmail={user?.email} isAdmin={isAdmin}>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </Shell>
    </LocaleProvider>
  )
}
