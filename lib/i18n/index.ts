// Server-safe exports (can be used in server AND client components)
export { isValidLocale, formatLocalDate, LOCALE_LABELS } from './utils'
export type { Locale } from './utils'

// Client-only exports (requires 'use client' context)
export { LocaleProvider, useLocale } from './context'

// Type re-exports
export type { TranslationKey } from './translations/en'
