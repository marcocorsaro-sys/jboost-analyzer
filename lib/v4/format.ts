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

/**
 * Fix 13/10 (Traffic evidence): a compact range of months — ["2026-07-01",
 * "2026-08-01", "2026-09-01"] -> "lug-ago-set 2026" (it) / "Jul-Aug-Sep 2026"
 * (en). Months of different years keep their own year group ("nov-dic 2025,
 * gen 2026"). Unparsable dates pass through untouched, never dropped.
 */
export function formatMonthsRange(isoDates: string[], locale = 'it'): string {
  const names = locale === 'it' ? MONTHS_IT : MONTHS_EN
  const groups: Array<{ year: string; months: string[] }> = []
  for (const d of isoDates) {
    const m = d.match(/^(\d{4})-(\d{2})/)
    const idx = m ? Number(m[2]) - 1 : -1
    if (!m || idx < 0 || idx > 11) {
      groups.push({ year: '', months: [d] })
      continue
    }
    const last = groups[groups.length - 1]
    if (last && last.year === m[1]) last.months.push(names[idx])
    else groups.push({ year: m[1], months: [names[idx]] })
  }
  return groups
    .map((g) => (g.year ? `${g.months.join('-')} ${g.year}` : g.months.join('-')))
    .join(', ')
}

/**
 * Fix 13/10 (generic evidence renderer): one scalar evidence value as TEXT.
 * The contract that matters: a NUMBER is always rendered with its separators
 * (thousands by locale, locale decimal mark), so adjacent digits can never
 * read as one garbled figure; null stays "—", never 0; everything else goes
 * through String().
 */
export function formatEvidenceValue(value: unknown, locale = 'it'): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    if (Number.isInteger(value)) return formatInt(value, locale)
    const intPart = formatInt(Math.trunc(value), locale)
    const decimals = Math.abs(value % 1).toFixed(2).slice(2).replace(/0+$/, '')
    const mark = locale === 'it' ? ',' : '.'
    return decimals ? `${intPart}${mark}${decimals}` : intPart
  }
  return String(value)
}

/**
 * Fix 13/10: a list of primitive evidence values as ONE line. ALWAYS joined
 * with ", " — the generic renderer must never concatenate numbers without a
 * separator (team bug report: "il valore reale del traffico sono le ultime
 * cifre del numero riportato").
 */
export function formatPrimitiveList(
  list: unknown[],
  locale = 'it',
  max = 12,
): string {
  const shown = list.slice(0, max).map((v) => formatEvidenceValue(v, locale))
  return shown.join(', ') + (list.length > max ? '…' : '')
}
