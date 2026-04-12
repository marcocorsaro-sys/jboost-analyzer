import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { isValidLocale } from '@/lib/i18n'

export const metadata: Metadata = {
  title: 'JBoost Analyzer',
  description: 'SEO/GEO Analysis Platform — 9 Driver Framework',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const rawLocale = cookieStore.get('jboost-locale')?.value
  const lang = isValidLocale(rawLocale) ? rawLocale : 'en'

  return (
    <html lang={lang} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
