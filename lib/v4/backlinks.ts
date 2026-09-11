/**
 * V4 — Ahrefs backlink export parsing (review item 5, Authority upload).
 *
 * The Authority setup upload used to store only the file reference; a
 * malformed or unrecognized export surfaced as a generic "tool error". This
 * module parses the standard Ahrefs exports at upload time:
 *
 *  - .csv (Ahrefs exports UTF-8 or UTF-16 with BOM — SheetJS handles both)
 *  - .xlsx / .xls
 *  - both the "Backlinks" export (Referring page URL, Domain rating, ...) and
 *    the "Referring domains" export (Referring domain, Domain rating, ...)
 *
 * Validation is deliberately loose (an Ahrefs standard export MUST pass):
 * the header row needs a URL-ish source column and a rating column. The
 * parsed result (columns + row count + a bounded sample of raw rows) is
 * saved on the attachment record and travels into driver_runs.config via
 * driverConfigFromSetup — the qualitative use of the data comes downstream,
 * but the upload itself never fails on a standard export again.
 *
 * Pure: Buffer in, result out. No I/O, testable with fixtures.
 */

import * as XLSX from 'xlsx'

/** Bounded raw sample stored in the jsonb config: enough for qualitative
 *  reading downstream without bloating the row. */
export const BACKLINK_SAMPLE_ROWS = 100

/** What the analyst sees in the error message when the columns are wrong. */
export const BACKLINK_EXPECTED_COLUMNS =
  '"Referring page URL" oppure "Referring domain", più "Domain rating" (DR)'

/** Header names (lowercased) accepted as the backlink SOURCE column. */
const SOURCE_HEADERS = [
  'referring page url',
  'referring domain',
  'source url',
  'url from',
  'referring page',
]

/** Header names (lowercased) accepted as the RATING column. */
const RATING_HEADERS = ['domain rating', 'dr', 'domain rating (dr)', 'url rating', 'ur']

export interface ParsedBacklinks {
  columns: string[]
  row_count: number
  sample: Array<Record<string, unknown>>
}

export type BacklinkParseResult =
  | { ok: true; parsed: ParsedBacklinks }
  | { ok: false; error: string }

function headerMatches(header: string, candidates: string[]): boolean {
  const h = header.trim().toLowerCase()
  return candidates.some((c) => h === c || h.startsWith(`${c} `) || h.startsWith(`${c}(`))
}

/**
 * Parse an Ahrefs backlink export (.csv/.xlsx/.xls buffer). Never throws:
 * every failure comes back as { ok: false, error } with a specific reason,
 * so the route can compose the explicit message the review asked for.
 */
export function parseBacklinksBuffer(buffer: Buffer): BacklinkParseResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  } catch (err) {
    return {
      ok: false,
      error: `file non leggibile come CSV/XLSX (${err instanceof Error ? err.message : String(err)})`,
    }
  }

  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheet) return { ok: false, error: 'il file non contiene alcun foglio dati' }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
  if (matrix.length === 0) return { ok: false, error: 'il file è vuoto' }

  const headerRow = (matrix[0] ?? []).map((c) => (c === null || c === undefined ? '' : String(c)))
  const columns = headerRow.filter((c) => c.trim() !== '')
  if (columns.length === 0) return { ok: false, error: 'nessuna intestazione di colonna nella prima riga' }

  const hasSource = columns.some((c) => headerMatches(c, SOURCE_HEADERS))
  const hasRating = columns.some((c) => headerMatches(c, RATING_HEADERS))
  if (!hasSource || !hasRating) {
    return {
      ok: false,
      error:
        `colonne non riconosciute (trovate: ${columns.slice(0, 8).join(', ')}${columns.length > 8 ? ', …' : ''}). ` +
        `Attese le colonne standard Ahrefs: ${BACKLINK_EXPECTED_COLUMNS}`,
    }
  }

  const dataRows = matrix
    .slice(1)
    .filter((row) => Array.isArray(row) && row.some((c) => c !== null && String(c).trim() !== ''))
  if (dataRows.length === 0) {
    return { ok: false, error: 'nessuna riga dati sotto le intestazioni' }
  }

  const sample = dataRows.slice(0, BACKLINK_SAMPLE_ROWS).map((row) => {
    const out: Record<string, unknown> = {}
    headerRow.forEach((name, i) => {
      if (name.trim() === '') return
      out[name] = row[i] ?? null
    })
    return out
  })

  return { ok: true, parsed: { columns, row_count: dataRows.length, sample } }
}
