import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Source_Sans_3 } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { isValidLocale } from '@/lib/i18n'

/** JAKALA UI font — Source Sans 3, weights 400/600/700, system-ui fallback. */
const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})

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
      <body className={`${sourceSans.variable} antialiased`}>
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
