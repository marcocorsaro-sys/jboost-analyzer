import { encode } from 'gpt-tokenizer'
import type { Chunk } from './types'

export interface ChunkOptions {
  maxTokens?: number
  overlapTokens?: number
}

const DEFAULT_MAX_TOKENS = 500
const DEFAULT_OVERLAP_TOKENS = 50

export async function chunkText(text: string, options?: ChunkOptions): Promise<Chunk[]> {
  const maxTokens = Math.max(50, options?.maxTokens ?? DEFAULT_MAX_TOKENS)
  const overlapTokens = Math.max(0, Math.min(options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS, Math.floor(maxTokens / 2)))

  const normalized = (text ?? '').replace(/\r\n/g, '\n').trim()
  if (normalized.length === 0) return []

  // Split into paragraphs first
  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  // Build atomic units: paragraphs that are too big are recursively split into sentences,
  // then into words. Each unit is { text, tokens }.
  type Unit = { text: string; tokens: number }
  const units: Unit[] = []

  for (const para of paragraphs) {
    addUnit(para, maxTokens, units)
  }

  // Now greedily pack units into chunks of <= maxTokens. We track offsets
  // by walking the original normalized text.
  const chunks: Chunk[] = []
  let chunkIndex = 0
  let cursor = 0
  let buffer: Unit[] = []
  let bufferTokens = 0

  const flush = () => {
    if (buffer.length === 0) return
    const content = buffer.map((u) => u.text).join('\n\n')
    const tokenCount = countTokens(content)
    const startOffset = findOffset(normalized, content, cursor)
    const offsetStart = startOffset >= 0 ? startOffset : cursor
    const offsetEnd = offsetStart + content.length
    chunks.push({
      index: chunkIndex++,
      content,
      tokenCount,
      metadata: { offsetStart, offsetEnd },
    })
    cursor = offsetEnd

    // Build overlap: take trailing tokens worth of text from current buffer
    if (overlapTokens > 0) {
      const overlap = takeTrailingTokens(content, overlapTokens)
      if (overlap.length > 0) {
        const overlapTok = countTokens(overlap)
        buffer = [{ text: overlap, tokens: overlapTok }]
        bufferTokens = overlapTok
        return
      }
    }
    buffer = []
    bufferTokens = 0
  }

  for (const unit of units) {
    if (bufferTokens + unit.tokens > maxTokens && buffer.length > 0) {
      flush()
    }
    buffer.push(unit)
    bufferTokens += unit.tokens
  }
  flush()

  return chunks
}

function addUnit(text: string, maxTokens: number, out: { text: string; tokens: number }[]): void {
  const trimmed = text.trim()
  if (trimmed.length === 0) return
  const tokens = countTokens(trimmed)
  if (tokens <= maxTokens) {
    out.push({ text: trimmed, tokens })
    return
  }
  // Split on sentences
  const sentences = splitSentences(trimmed)
  if (sentences.length > 1) {
    for (const s of sentences) addUnit(s, maxTokens, out)
    return
  }
  // Last resort: split on words into roughly maxTokens-sized blocks
  const words = trimmed.split(/\s+/)
  if (words.length <= 1) {
    out.push({ text: trimmed, tokens })
    return
  }
  const blockSize = Math.max(1, Math.floor((words.length * maxTokens) / Math.max(1, tokens)))
  for (let i = 0; i < words.length; i += blockSize) {
    const slice = words.slice(i, i + blockSize).join(' ')
    out.push({ text: slice, tokens: countTokens(slice) })
  }
}

function splitSentences(text: string): string[] {
  // Split on sentence terminators followed by whitespace and capital/quote.
  // Tolerant: works fine on plain prose; degenerate cases just return one entry.
  const parts = text.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ"'(\[])/u)
  return parts.map((s) => s.trim()).filter(Boolean)
}

function countTokens(text: string): number {
  if (!text) return 0
  try {
    return encode(text).length
  } catch {
    // Fallback: rough estimate (4 chars/token)
    return Math.ceil(text.length / 4)
  }
}

function takeTrailingTokens(text: string, n: number): string {
  if (n <= 0) return ''
  const tokens = encode(text)
  if (tokens.length <= n) return text
  // Walk back from the end character-by-character until we have <= n tokens
  // (decode is not in the basic gpt-tokenizer API, so we approximate via slicing words)
  const words = text.split(/(\s+)/)
  let acc = ''
  for (let i = words.length - 1; i >= 0; i--) {
    const candidate = words[i] + acc
    if (countTokens(candidate) > n) break
    acc = candidate
  }
  return acc.trim()
}

function findOffset(haystack: string, needle: string, fromIndex: number): number {
  if (!needle) return fromIndex
  // Try a direct search starting from cursor position
  const idx = haystack.indexOf(needle, Math.max(0, fromIndex - 10))
  if (idx >= 0) return idx
  // Fall back to a search from beginning
  return haystack.indexOf(needle)
}
