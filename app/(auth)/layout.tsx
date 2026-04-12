import { cookies } from 'next/headers'
import { LocaleProvider, isValidLocale, type Locale } from '@/lib/i18n'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const rawLocale = cookieStore.get('jboost-locale')?.value
  const cookieLocale: Locale = isValidLocale(rawLocale) ? rawLocale : 'en'

  return (
    <LocaleProvider initialLocale={cookieLocale}>
      {children}
    </LocaleProvider>
  )
}
