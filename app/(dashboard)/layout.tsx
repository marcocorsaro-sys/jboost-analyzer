import { cookies } from 'next/headers'
import { getUser, getProfileRole } from '@/lib/supabase/server'
import { LocaleProvider, isValidLocale, type Locale } from '@/lib/i18n'
import { Shell } from '@/components/layout/shell'
import SpendLimitBanner from '@/components/layout/SpendLimitBanner'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Read locale from cookie — no flash of English
  const cookieStore = await cookies()
  const rawLocale = cookieStore.get('jboost-locale')?.value
  const cookieLocale: Locale = isValidLocale(rawLocale) ? rawLocale : 'en'

  const user = await getUser()
  const isAdmin = user ? (await getProfileRole(user.id)) === 'admin' : false

  return (
    <LocaleProvider initialLocale={cookieLocale}>
      <Shell userEmail={user?.email} isAdmin={isAdmin}>
        <SpendLimitBanner />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </Shell>
    </LocaleProvider>
  )
}
