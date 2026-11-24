/**
 * V4 — Semrush Site Audit "Overview" PDF parsing (Compliance, manual upload).
 *
 * The analyst can upload the Semrush Site Audit overview as a PDF (Export >
 * PDF) in place of the CSV/XLSX. Same contract as parseSemrushMatrix: the
 * Site Health IS the measurement; the rest (AI Search Health, crawled pages
 * breakdown, errors/warnings/notices, top issues) is qualitative context.
 *
 * PURE: works on the text pdf-parse extracts (the extraction itself lives in
 * the upload route). The PDF text order varies with the layout, so the
 * score is searched with both orders ("Site Health 90%" and "90% Site
 * Health"). No match = explicit error, never a guess and never 0.
 */

import type { SemrushParseResult } from './semrush-export'

export interface SemrushPdfExtra {
  ai_search_health: number | null
  pages_crawled: number | null
  /** Crawled pages by status (Healthy / Have issues / Redirects / Broken / Blocked). */
  pages_breakdown: Record<string, number>
  errors: number | null
  warnings: number | null
  notices: number | null
}

export type SemrushPdfParseResult =
  | { ok: true; parsed: Extract<SemrushParseResult, { ok: true }>['parsed']; extra: SemrushPdfExtra }
  | { ok: false; error: string }

const NUM = String.raw`(\d{1,3}(?:[.,]\d+)?)\s*%`

function toScore(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const n = Number(raw.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

type Direction = 'same' | 'next' | 'prev'

interface PctRead {
  value: number | null
  dir: Direction | null
  ambiguous: boolean
}

const PURE_PCT = new RegExp(`^${NUM}$`)

/**
 * Percentage tied to a label. PDF text comes in three shapes, tried in this
 * order: value on the SAME line as the label ("Site Health 90%"), on the NEXT
 * line (label above value) or on the PREVIOUS line (value above label). When
 * the value is on neither the same line nor a single side, but BOTH
 * neighbours are bare percentages with different values, the layout is
 * ambiguous: reported, never guessed. `prefer` carries the direction already
 * proven by another label of the same document.
 */
function pct(lines: string[], label: string, prefer: Direction | null = null): PctRead {
  const labelRe = new RegExp(label, 'i')
  const sameRe = new RegExp(`${label}[^0-9]{0,40}${NUM}`, 'i')
  const idx = lines.findIndex((l) => labelRe.test(l))
  if (idx < 0) return { value: null, dir: null, ambiguous: false }

  const same = toScore(sameRe.exec(lines[idx])?.[1])
  if (same !== null) return { value: same, dir: 'same', ambiguous: false }

  const next = toScore(PURE_PCT.exec(lines[idx + 1] ?? '')?.[1])
  const prev = toScore(PURE_PCT.exec(lines[idx - 1] ?? '')?.[1])
  if (prefer === 'next' && next !== null) return { value: next, dir: 'next', ambiguous: false }
  if (prefer === 'prev' && prev !== null) return { value: prev, dir: 'prev', ambiguous: false }
  if (next !== null && prev !== null && next !== prev) {
    return { value: null, dir: null, ambiguous: true }
  }
  if (next !== null) return { value: next, dir: 'next', ambiguous: false }
  if (prev !== null) return { value: prev, dir: 'prev', ambiguous: false }
  return { value: null, dir: null, ambiguous: false }
}

function count(text: string, label: string): number | null {
  const after = new RegExp(`${label}\\s*[:\\-]?\\s*(\\d[\\d.,]*)`, 'i').exec(text)
  const before = new RegExp(`(\\d[\\d.,]*)\\s*(?:\\n\\s*)?${label}\\b`, 'i').exec(text)
  const raw = after?.[1] ?? before?.[1]
  if (raw === undefined) return null
  const n = Number(raw.replace(/[.,]/g, ''))
  return Number.isFinite(n) ? n : null
}

const BREAKDOWN: Array<[string, string]> = [
  ['healthy', 'Healthy'],
  ['have_issues', 'Have issues'],
  ['redirects', 'Redirects?'],
  ['broken', 'Broken'],
  ['blocked', 'Blocked'],
]

export function parseSemrushPdfText(text: string): SemrushPdfParseResult {
  const body = text.replace(/\r/g, '')
  if (body.trim() === '') {
    return { ok: false, error: 'nessun testo estraibile dal PDF (potrebbe essere una scansione)' }
  }

  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const health = pct(lines, 'Site\\s*Health')
  if (health.ambiguous) {
    return {
      ok: false,
      error:
        'il PDF riporta due valori diversi accanto a "Site Health" e non è chiaro quale sia il ' +
        'punteggio: carica l\'export CSV/XLSX del Site Audit',
    }
  }
  const siteHealth = health.value
  if (siteHealth === null) {
    return {
      ok: false,
      error:
        'nessun valore "Site Health" trovato nel PDF: serve l\'overview del Site Audit di Semrush ' +
        '(la pagina con Site Health in percentuale)',
    }
  }

  const pagesBreakdown: Record<string, number> = {}
  for (const [key, label] of BREAKDOWN) {
    const n = count(body, label)
    if (n !== null) pagesBreakdown[key] = n
  }
  const crawledSum = Object.values(pagesBreakdown).reduce((a, b) => a + b, 0)
  const crawledLabel = count(body, 'Crawled\\s*Pages') ?? count(body, 'Pages\\s*crawled')
  const extra: SemrushPdfExtra = {
    ai_search_health: pct(lines, 'AI\\s*Search\\s*Health', health.dir).value,
    pages_crawled: crawledLabel ?? (crawledSum > 0 ? crawledSum : null),
    pages_breakdown: pagesBreakdown,
    errors: count(body, 'Errors'),
    warnings: count(body, 'Warnings'),
    notices: count(body, 'Notices'),
  }

  // Top issues (opportunistic): lines "Title ... N" after an issues heading.
  const issues: Array<{ title: string; type: string; pages_count: number }> = []
  let inIssues = false
  let kind = 'warning'
  for (const line of lines) {
    if (/^top\s+issues/i.test(line)) {
      inIssues = true
      continue
    }
    if (!inIssues) continue
    if (/^errors?$/i.test(line)) kind = 'error'
    else if (/^warnings?$/i.test(line)) kind = 'warning'
    else if (/^notices?$/i.test(line)) kind = 'notice'
    const m = /^(.{6,140}?)\s+(\d{1,6})(?:\s+pages?)?$/i.exec(line)
    if (m && !/^(page|of|total)/i.test(m[1])) {
      issues.push({ title: m[1].trim(), type: kind, pages_count: Number(m[2]) })
      if (issues.length >= 25) break
    }
  }
  issues.sort((a, b) => b.pages_count - a.pages_count)

  return {
    ok: true,
    parsed: {
      site_health: siteHealth,
      issues,
      row_count: lines.length,
      columns: ['Site Health'],
    },
    extra,
  }
}
