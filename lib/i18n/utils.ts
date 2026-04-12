// Server-safe i18n utilities (no 'use client')
// These can be imported from both server and client components.

export type Locale = 'en' | 'it' | 'es' | 'fr'

export const VALID_LOCALES: readonly Locale[] = ['en', 'it', 'es', 'fr'] as const

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  it: 'Italiano',
  es: 'Español',
  fr: 'Français',
}

/** Locale → Intl BCP-47 mapping for date formatting */
const LOCALE_BCP47: Record<Locale, string> = {
  en: 'en-US',
  it: 'it-IT',
  es: 'es-ES',
  fr: 'fr-FR',
}

/** Validate a string is a known Locale */
export function isValidLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (VALID_LOCALES as readonly string[]).includes(v)
}

/** Format a date according to the active locale */
export function formatLocalDate(
  date: string | Date,
  locale: Locale,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString(LOCALE_BCP47[locale], opts ?? { day: '2-digit', month: 'short', year: 'numeric' })
}
