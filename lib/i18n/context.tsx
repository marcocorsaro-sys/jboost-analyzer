'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import en, { type TranslationKey } from './translations/en'
import it from './translations/it'
import es from './translations/es'
import fr from './translations/fr'
import { isValidLocale, type Locale } from './utils'

const translations: Record<Locale, Record<string, string>> = { en, it, es, fr }

const STORAGE_KEY = 'jboost-locale'
const COOKIE_KEY = 'jboost-locale'
const DEFAULT_LOCALE: Locale = 'en'

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: TranslationKey) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

interface LocaleProviderProps {
  children: ReactNode
  /** Server-read cookie value — avoids flash of wrong language */
  initialLocale?: Locale
}

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale || DEFAULT_LOCALE)
  const router = useRouter()

  // Reconcile cookie ↔ localStorage on mount (only if no initialLocale was provided)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Locale | null
      if (stored && isValidLocale(stored)) {
        if (!initialLocale) {
          setLocaleState(stored)
        }
        // Sync cookie with localStorage value if they differ
        const cookieVal = document.cookie
          .split('; ')
          .find((c) => c.startsWith(`${COOKIE_KEY}=`))
          ?.split('=')[1]
        if (cookieVal !== stored) {
          document.cookie = `${COOKIE_KEY}=${stored};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`
        }
      } else if (initialLocale) {
        // Server had a cookie but localStorage is empty — seed it
        localStorage.setItem(STORAGE_KEY, initialLocale)
      }
    } catch {
      // localStorage unavailable
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // localStorage unavailable
    }
    // Write cookie so the server can read it on next request
    document.cookie = `${COOKIE_KEY}=${l};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`
    // Refresh server components so they pick up the new <html lang>
    router.refresh()
  }, [router])

  const t = useCallback((key: TranslationKey): string => {
    return translations[locale]?.[key] || translations[DEFAULT_LOCALE][key] || key
  }, [locale])

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    // Fallback for server components or outside provider — return EN defaults
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key: TranslationKey) => en[key] || key,
    }
  }
  return ctx
}
