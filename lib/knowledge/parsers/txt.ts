import type { ParsedDocument, ParsedSegment } from '../types'

export async function parseTxt(buffer: Buffer): Promise<ParsedDocument> {
  const rawText = buffer.toString('utf8').replace(/\r\n/g, '\n').trim()
  const segments: ParsedSegment[] = rawText.length
    ? [{ label: 'Content', content: rawText, metadata: {} }]
    : []

  return {
    rawText,
    segments,
    metadata: {
      byteLength: buffer.length,
      lineCount: rawText ? rawText.split('\n').length : 0,
    },
  }
}
