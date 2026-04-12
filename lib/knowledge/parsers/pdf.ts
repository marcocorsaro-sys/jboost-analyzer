import type { ParsedDocument, ParsedSegment } from '../types'

export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // pdf-parse v2 exports a PDFParse class (not a default callable). Dynamic
  // import avoids loading it at module evaluation time (the lib touches fs at
  // import on some versions).
  const mod = await import('pdf-parse')
  const PDFParseCtor = (mod as { PDFParse?: unknown }).PDFParse
    ?? (mod as { default?: { PDFParse?: unknown } }).default?.PDFParse
  if (typeof PDFParseCtor !== 'function') {
    throw new Error('pdf-parse module did not export the PDFParse class')
  }

  const parser = new (PDFParseCtor as new (opts: { data: Buffer }) => {
    getText(): Promise<{ text: string; pages?: Array<{ text: string; pageNumber?: number }> }>
    getInfo(): Promise<{ numPages?: number; info?: Record<string, unknown> }>
    destroy(): Promise<void>
  })({ data: buffer })

  let textResult: { text: string; pages?: Array<{ text: string; pageNumber?: number }> }
  let infoResult: { numPages?: number; info?: Record<string, unknown> } | null = null

  try {
    textResult = await parser.getText()
    try {
      infoResult = await parser.getInfo()
    } catch {
      // info is nice-to-have; ignore failures
      infoResult = null
    }
  } finally {
    try {
      await parser.destroy()
    } catch {
      // best-effort cleanup
    }
  }

  const rawText = normalizeText(textResult.text || '')
  const pageCount = infoResult?.numPages ?? textResult.pages?.length ?? 0

  // Prefer per-page text from pdf-parse v2 when available; else fall back to
  // form-feed splits, else to a heuristic split on blank lines.
  let pageSplits: string[]
  if (Array.isArray(textResult.pages) && textResult.pages.length > 0) {
    pageSplits = textResult.pages.map((p) => (p.text ?? '').trim())
  } else if (rawText.includes('\f')) {
    pageSplits = rawText.split(/\f+/)
  } else {
    pageSplits = splitByBlankLines(rawText, pageCount)
  }

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
      info: infoResult?.info ?? null,
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
