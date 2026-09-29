/**
 * V4 — Semrush Site Audit export parsing (Sprint 1, review 2.1 item 4b).
 *
 * The Compliance driver reads Site Health from the Semrush API, which only
 * works when a Site Audit PROJECT exists for the domain. When it does not
 * (competitors, usually), the analyst can export the Site Audit overview from
 * Semrush and upload it per site: this module turns that export into the
 * same measurement the API would have produced.
 *
 * PURE ON PURPOSE: the core works on a cell matrix (rows of cells) and the
 * CSV entry point parses text with its own small CSV reader, so the module
 * has NO dependency on SheetJS and its tests run standalone. The .xlsx path
 * lives in the upload route, which converts the workbook to a matrix with
 * the XLSX reader it already uses for the Ahrefs backlink export and then
 * calls parseSemrushMatrix.
 *
 * Recognized shapes (both produced by Semrush "Export" buttons):
 *  1. Overview export: a cell whose label matches "Site Health" (any case,
 *     with or without "%"), with the numeric value beside it (same row) or
 *     right under it (next row). Thematic rows around it are ignored.
 *  2. Column export: a header row containing a "Site Health" column; the
 *     value is read from the first data row.
 * Issue rows are extracted opportunistically when the sheet has an issue
 * table (a header with an "Issue"/"Title" column plus a "Pages"/"Count"
 * column, with an optional "Type"/"Severity" column).
 *
 * An unrecognized format is an EXPLICIT error naming the expected columns,
 * never a guess and never a 0 (the V4 no-fallback rule).
 */

export const SEMRUSH_EXPECTED_COLUMNS =
  'una cella o colonna "Site Health" con il punteggio 0-100 (export Semrush Site Audit); ' +
  'opzionale una tabella issues con colonne "Issue"/"Title" e "Pages"/"Count"'

export interface ParsedSemrushExport {
  /** Semrush Site Health, 0-100. Always present on ok=true. */
  site_health: number
  /** Top issues by pages count (bounded), when the export carries them. */
  issues: Array<{ title: string; type: string; pages_count: number }>
  /** Non-empty data rows seen, for the attachment chip. */
  row_count: number
  columns: string[]
}

export type SemrushParseResult =
  | { ok: true; parsed: ParsedSemrushExport }
  | { ok: false; error: string }

const MAX_ISSUES = 25

const SITE_HEALTH_RE = /^site\s*health(\s*(score|%|\(%\)))?$/i
const ISSUE_TITLE_HEADERS = ['issue', 'issue title', 'title', 'issue name', 'name', 'problema']
const ISSUE_COUNT_HEADERS = ['pages', 'pages count', 'count', 'affected pages', 'n. pagine', 'numero pagine', 'pagine']
const ISSUE_TYPE_HEADERS = ['type', 'severity', 'issue type', 'category', 'tipo', 'severita', 'severità']

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  return String(cell).trim()
}

/** "87%", "87,4", " 87 " -> 87 / 87.4; null when not a plausible 0-100. */
function readScore(raw: string): number | null {
  const cleaned = raw.replace(/%/g, '').replace(/,/g, '.').trim()
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

function headerIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((h) => {
    const low = h.trim().toLowerCase()
    return candidates.some((c) => low === c || low.startsWith(`${c} (`) || low.startsWith(`${c}(`))
  })
}

/**
 * Core parser: cell matrix in, measurement out. Never throws.
 */
export function parseSemrushMatrix(matrix: unknown[][]): SemrushParseResult {
  const rows = matrix.map((row) => (Array.isArray(row) ? row.map(cellText) : []))
  const dataRows = rows.filter((r) => r.some((c) => c !== ''))
  if (dataRows.length === 0) {
    return { ok: false, error: 'il file è vuoto (nessuna cella con contenuto)' }
  }

  // --- Site Health, shape 1: labelled cell -------------------------------
  let siteHealth: number | null = null
  outer: for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (!SITE_HEALTH_RE.test(rows[r][c])) continue
      // Same row, cells to the right, then the same column of the next row.
      for (let k = c + 1; k < rows[r].length; k++) {
        const v = readScore(rows[r][k])
        if (v !== null) {
          siteHealth = v
          break outer
        }
      }
      const below = rows[r + 1]?.[c]
      if (below !== undefined) {
        const v = readScore(below)
        if (v !== null) {
          siteHealth = v
          break outer
        }
      }
    }
  }

  // --- Site Health, shape 2: header column -------------------------------
  const columns = dataRows[0]
  if (siteHealth === null) {
    const idx = columns.findIndex((h) => SITE_HEALTH_RE.test(h))
    if (idx >= 0) {
      for (let r = 1; r < dataRows.length; r++) {
        const v = readScore(dataRows[r][idx] ?? '')
        if (v !== null) {
          siteHealth = v
          break
        }
      }
    }
  }

  if (siteHealth === null) {
    const preview = columns.filter((c) => c !== '').slice(0, 8).join(', ')
    return {
      ok: false,
      error:
        `formato export Semrush non riconosciuto: nessun valore "Site Health" trovato ` +
        `(prima riga: ${preview || 'vuota'}). Attese: ${SEMRUSH_EXPECTED_COLUMNS}`,
    }
  }

  // --- Issues table (opportunistic) --------------------------------------
  const issues: ParsedSemrushExport['issues'] = []
  for (let r = 0; r < rows.length; r++) {
    const header = rows[r]
    const titleIdx = headerIndex(header, ISSUE_TITLE_HEADERS)
    const countIdx = headerIndex(header, ISSUE_COUNT_HEADERS)
    if (titleIdx < 0 || countIdx < 0 || titleIdx === countIdx) continue
    const typeIdx = headerIndex(header, ISSUE_TYPE_HEADERS)

    for (let d = r + 1; d < rows.length && issues.length < MAX_ISSUES; d++) {
      const row = rows[d]
      const title = row[titleIdx] ?? ''
      const countRaw = (row[countIdx] ?? '').replace(/[.,\s]/g, '')
      if (title === '' || !/^\d+$/.test(countRaw)) {
        // A non-issue row ends the table only after at least one real row.
        if (issues.length > 0) break
        continue
      }
      issues.push({
        title,
        type: typeIdx >= 0 && row[typeIdx] ? row[typeIdx].toLowerCase() : 'warning',
        pages_count: Number(countRaw),
      })
    }
    if (issues.length > 0) break
  }
  issues.sort((a, b) => b.pages_count - a.pages_count)

  return {
    ok: true,
    parsed: {
      site_health: siteHealth,
      issues,
      row_count: dataRows.length,
      columns: columns.filter((c) => c !== ''),
    },
  }
}

/**
 * Minimal CSV reader (quotes, escaped quotes, CRLF), with ',' vs ';'
 * delimiter sniffing — Semrush exports use ',' but locales with the Excel
 * round-trip produce ';'. Pure, no dependency.
 */
export function parseCsvMatrix(text: string): string[][] {
  const body = text.replace(/^﻿/, '')
  const firstLine = body.split(/\r?\n/, 1)[0] ?? ''
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** CSV text in, measurement out — the pure end-to-end entry point. */
export function parseSemrushCsvText(text: string): SemrushParseResult {
  if (!text.trim()) return { ok: false, error: 'il file è vuoto' }
  return parseSemrushMatrix(parseCsvMatrix(text))
}
