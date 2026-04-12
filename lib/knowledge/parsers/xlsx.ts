import type { ParsedDocument, ParsedSegment } from '../types'

export async function parseXlsx(buffer: Buffer): Promise<ParsedDocument> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })

  const sheetNames = workbook.SheetNames
  const segments: ParsedSegment[] = []
  const rawTextParts: string[] = []

  for (const name of sheetNames) {
    const ws = workbook.Sheets[name]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
    })
    const markdown = rowsToMarkdown(rows as unknown[][])
    if (markdown.trim().length === 0) continue

    const segmentContent = `## Sheet: ${name}\n\n${markdown}`
    segments.push({
      label: `Sheet: ${name}`,
      content: segmentContent,
      metadata: { sheetName: name, rowCount: rows.length },
    })
    rawTextParts.push(segmentContent)
  }

  const rawText = rawTextParts.join('\n\n').trim()

  return {
    rawText,
    segments,
    metadata: {
      sheetCount: sheetNames.length,
      sheetNames,
    },
  }
}

function rowsToMarkdown(rows: unknown[][]): string {
  if (!rows || rows.length === 0) return ''
  // Trim trailing empty rows
  let last = rows.length - 1
  while (last >= 0 && isEmptyRow(rows[last])) last--
  if (last < 0) return ''
  const trimmed = rows.slice(0, last + 1)

  // Determine maximum column width to keep table consistent
  const maxCols = trimmed.reduce((m, r) => Math.max(m, r.length), 0)
  if (maxCols === 0) return ''

  const lines: string[] = []
  const header = trimmed[0]
  const headerCells = padRow(header, maxCols).map(cellToString)
  lines.push(`| ${headerCells.join(' | ')} |`)
  lines.push(`| ${headerCells.map(() => '---').join(' | ')} |`)

  for (let i = 1; i < trimmed.length; i++) {
    const cells = padRow(trimmed[i], maxCols).map(cellToString)
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

function padRow(row: unknown[], length: number): unknown[] {
  if (row.length >= length) return row
  return [...row, ...new Array(length - row.length).fill('')]
}

function isEmptyRow(row: unknown[] | undefined): boolean {
  if (!row) return true
  return row.every((c) => c === undefined || c === null || String(c).trim() === '')
}

function cellToString(c: unknown): string {
  if (c === null || c === undefined) return ''
  const s = String(c)
  // Escape pipe to keep table valid
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
