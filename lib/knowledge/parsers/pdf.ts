import type { ParsedDocument, ParsedSegment } from '../types'

export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // pdf-parse default export is a function. Dynamic import avoids loading it
  // at module evaluation time (the lib touches fs at import on some versions).
  const mod = await import('pdf-parse')
  const pdfParse = (mod as { default?: unknown }).default ?? mod
  if (typeof pdfParse !== 'function') {
    throw new Error('pdf-parse module did not export a callable parser')
  }

  const result = (await (pdfParse as (b: Buffer) => Promise<{
    text: string
    numpages: number
    info?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }>)(buffer))

  const rawText = normalizeText(result.text || '')
  const pageCount = result.numpages ?? 0

  // Try to split by form feed first, which pdf-parse emits between pages
  // when available. Otherwise fall back to a heuristic split on blank lines.
  const pageSplits = rawText.includes('\f')
    ? rawText.split(/\f+/)
    : splitByBlankLines(rawText, pageCount)

  const segments: ParsedSegment[] = pageSplits
    .map((content, i) => ({
      label: `Page ${i + 1}`,
      content: content.trim(),
      metadata: { page: i + 1 },
    }))
    .filter((s) => s.content.length > 0)

  return {
    rawText,
    segments,
    metadata: {
      pageCount,
      info: result.info ?? null,
    },
  }
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function splitByBlankLines(text: string, pageCount: number): string[] {
  if (pageCount <= 1) return [text]
  // Rough heuristic: split text into `pageCount` roughly equal chunks at
  // paragraph boundaries. This is only a fallback when pdf-parse doesn't
  // emit form-feed separators.
  const paragraphs = text.split(/\n{2,}/)
  if (paragraphs.length <= pageCount) return [text]
  const perPage = Math.ceil(paragraphs.length / pageCount)
  const pages: string[] = []
  for (let i = 0; i < paragraphs.length; i += perPage) {
    pages.push(paragraphs.slice(i, i + perPage).join('\n\n'))
  }
  return pages
}
