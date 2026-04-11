'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import en, { type TranslationKey } from './translations/en'
import it from './translations/it'
import es from './translations/es'
import fr from './translations/fr'

export type Locale = 'en' | 'it' | 'es' | 'fr'

const translations: Record<Locale, Record<string, string>> = { en, it, es, fr }

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  it: 'Italiano',
  es: 'Español',
  fr: 'Français',
}

const STORAGE_KEY = 'jboost-locale'
const DEFAULT_LOCALE: Locale = 'en'

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: TranslationKey) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  // Read from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Locale | null
      if (stored && translations[stored]) {
        setLocaleState(stored)
      }
    } catch {
      // localStorage unavailable
    }
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // localStorage unavailable
    }
  }, [])

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
