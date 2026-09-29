/**
 * V4 — pure number formatting for the results UI (Sprint 2 item 17).
 *
 * The Traffic evidence used to print raw floats ("78950.4") with no
 * explanation. These helpers keep the formatting deterministic and testable
 * without pulling a locale library: thousands separator by locale, no
 * spurious decimals on integers.
 */

/** '.' for it (12.847), ',' for everything else (12,847). */
export function thousandsSeparator(locale: string): string {
  return locale === 'it' ? '.' : ','
}

/**
 * Integer with thousands separators, no decimals: 1234567 -> "1.234.567"
 * (it) / "1,234,567" (en). null/NaN stay "—" — never a fabricated 0.
 */
export function formatInt(value: number | null | undefined, locale = 'it'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value)
  const sign = rounded < 0 ? '-' : ''
  const digits = Math.abs(rounded).toString()
  const sep = thousandsSeparator(locale)
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
  return `${sign}${grouped}`
}

/**
 * Signed percentage with one decimal at most, decimal mark by locale:
 * 12.34 -> "+12,3%" (it). Trailing ",0" is dropped ("+12%").
 */
export function formatPct(value: number | null | undefined, locale = 'it'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10) / 10
  const sign = rounded > 0 ? '+' : ''
  let text = String(rounded)
  if (text.endsWith('.0')) text = text.slice(0, -2)
  if (locale === 'it') text = text.replace('.', ',')
  return `${sign}${text}%`
}

/** "2026-03" or "2026-03-01" -> "mar 2026" (it) / "Mar 2026" (en). */
const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatMonth(isoDate: string, locale = 'it'): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})/)
  if (!m) return isoDate
  const idx = Number(m[2]) - 1
  const names = locale === 'it' ? MONTHS_IT : MONTHS_EN
  if (idx < 0 || idx > 11) return isoDate
  return `${names[idx]} ${m[1]}`
}
