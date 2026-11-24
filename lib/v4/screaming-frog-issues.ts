/**
 * V4 — Screaming Frog "Issues Overview" export parsing (Compliance, qualitative).
 *
 * The crawl upload of the Compliance tab (kind 'compliance_crawl') used to be
 * stored and never read. The file the team actually uploads is the Screaming
 * Frog "Issues Overview" CSV (Reports > Issues > Issues Overview), one row
 * per issue with the columns:
 *   Issue Name, Issue Type, Issue Priority, URLs, % of Total, Description, How To Fix
 *
 * Per the Bibbia the Compliance SCORE is the Semrush Site Health only: these
 * issues are QUALITATIVE evidence (they never enter the score) and travel to
 * the Compliance evidence of the client site, where the insight reads them.
 *
 * PURE: text/matrix in, summary out; no SheetJS dependency (the .xlsx path
 * lives in the upload route, which converts the sheet to a matrix first).
 * An unrecognized shape is an explicit error naming the expected columns,
 * never an empty success.
 */

import { parseCsvMatrix } from './semrush-export'

export const SF_ISSUES_EXPECTED_COLUMNS =
  'export "Issues Overview" di Screaming Frog (Reports > Issues > Issues Overview) con le colonne ' +
  '"Issue Name", "Issue Type", "Issue Priority", "URLs", "% of Total", "Description", "How To Fix"'

export type SfPriority = 'high' | 'medium' | 'low' | 'unknown'

export interface SfIssue {
  name: string
  /** Issue / Warning / Opportunity (Screaming Frog "Issue Type"). */
  type: string
  priority: SfPriority
  urls: number
  /** Share of crawled URLs, 0-100, when the export carries it. */
  pct_of_total: number | null
  description: string
  how_to_fix: string
}

export interface ParsedSfIssues {
  issues: SfIssue[]
  /** Rows with an issue name before the cap (the cap keeps the payload bounded). */
  issue_count: number
  columns: string[]
}

export type SfParseResult =
  | { ok: true; parsed: ParsedSfIssues }
  | { ok: false; error: string }

export const SF_MAX_ISSUES = 40
const TEXT_CAP = 320

const PRIORITY_RANK: Record<SfPriority, number> = { high: 0, medium: 1, low: 2, unknown: 3 }

function norm(s: unknown): string {
  return s === null || s === undefined ? '' : String(s).trim()
}

function findCol(headers: string[], candidates: string[]): number {
  return headers.findIndex((h) => candidates.includes(h.toLowerCase().replace(/\s+/g, ' ').trim()))
}

function toPriority(raw: string): SfPriority {
  const v = raw.toLowerCase()
  if (v.startsWith('high') || v.startsWith('alta')) return 'high'
  if (v.startsWith('med') || v.startsWith('medi')) return 'medium'
  if (v.startsWith('low') || v.startsWith('bass')) return 'low'
  return 'unknown'
}

function toInt(raw: string): number | null {
  const cleaned = raw.replace(/[.,\s]/g, '')
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null
}

function toPct(raw: string): number | null {
  const cleaned = raw.replace(/%/g, '').replace(',', '.').trim()
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

function cap(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > TEXT_CAP ? `${t.slice(0, TEXT_CAP - 1)}…` : t
}

export function parseScreamingFrogIssuesMatrix(matrix: unknown[][]): SfParseResult {
  const rows = matrix.map((r) => (Array.isArray(r) ? r.map(norm) : []))
  // The header is the first row carrying both an issue-name and a URLs column.
  let headerAt = -1
  let nameIdx = -1
  let urlsIdx = -1
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const n = findCol(rows[r], ['issue name', 'issue', 'nome problema', 'problema'])
    const u = findCol(rows[r], ['urls', 'url', 'urls affected', 'numero url'])
    if (n >= 0 && u >= 0 && n !== u) {
      headerAt = r
      nameIdx = n
      urlsIdx = u
      break
    }
  }
  if (headerAt < 0) {
    const preview = (rows.find((r) => r.some((c) => c !== '')) ?? [])
      .filter((c) => c !== '')
      .slice(0, 8)
      .join(', ')
    return {
      ok: false,
      error:
        `formato non riconosciuto: nessuna intestazione con "Issue Name" e "URLs" ` +
        `(prima riga: ${preview || 'vuota'}). Atteso: ${SF_ISSUES_EXPECTED_COLUMNS}`,
    }
  }

  const header = rows[headerAt]
  const typeIdx = findCol(header, ['issue type', 'type', 'tipo'])
  const prioIdx = findCol(header, ['issue priority', 'priority', 'priorità', 'priorita'])
  const pctIdx = findCol(header, ['% of total', '% of total urls', '% del totale'])
  const descIdx = findCol(header, ['description', 'descrizione'])
  const fixIdx = findCol(header, ['how to fix', 'come risolvere'])

  const all: SfIssue[] = []
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r]
    const name = row[nameIdx] ?? ''
    if (name === '') continue
    const urls = toInt(row[urlsIdx] ?? '')
    if (urls === null) continue
    all.push({
      name,
      type: typeIdx >= 0 ? (row[typeIdx] ?? '') : '',
      priority: prioIdx >= 0 ? toPriority(row[prioIdx] ?? '') : 'unknown',
      urls,
      pct_of_total: pctIdx >= 0 ? toPct(row[pctIdx] ?? '') : null,
      description: descIdx >= 0 ? cap(row[descIdx] ?? '') : '',
      how_to_fix: fixIdx >= 0 ? cap(row[fixIdx] ?? '') : '',
    })
  }
  if (all.length === 0) {
    return {
      ok: false,
      error: `nessuna riga issue leggibile sotto l'intestazione. Atteso: ${SF_ISSUES_EXPECTED_COLUMNS}`,
    }
  }

  all.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.urls - a.urls)
  return {
    ok: true,
    parsed: {
      issues: all.slice(0, SF_MAX_ISSUES),
      issue_count: all.length,
      columns: header.filter((c) => c !== ''),
    },
  }
}

export function parseScreamingFrogIssuesCsv(text: string): SfParseResult {
  return parseScreamingFrogIssuesMatrix(parseCsvMatrix(text))
}
