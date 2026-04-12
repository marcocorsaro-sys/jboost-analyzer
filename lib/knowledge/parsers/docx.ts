import type { ParsedDocument, ParsedSegment } from '../types'

interface MammothResult {
  value: string
  messages: { message: string }[]
}

interface MammothLike {
  convertToHtml(input: { buffer: Buffer }): Promise<MammothResult>
}

function resolveMammoth(mod: unknown): MammothLike {
  if (mod && typeof mod === 'object') {
    const m = mod as { convertToHtml?: unknown; default?: { convertToHtml?: unknown } }
    if (typeof m.convertToHtml === 'function') return m as unknown as MammothLike
    if (m.default && typeof m.default.convertToHtml === 'function') return m.default as unknown as MammothLike
  }
  throw new Error('Failed to resolve mammoth.convertToHtml from module')
}

export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const mod = await import('mammoth')
  const mammoth = resolveMammoth(mod)
  const result = await mammoth.convertToHtml({ buffer })
  const html = result.value || ''

  const markdown = htmlToMarkdown(html)
  const rawText = markdown.trim()

  const segments = splitOnHeaders(markdown)
  const wordCount = rawText.split(/\s+/).filter(Boolean).length

  return {
    rawText,
    segments,
    metadata: {
      wordCount,
      conversionMessages: (result.messages || []).map((m) => m.message),
    },
  }
}

function htmlToMarkdown(html: string): string {
  let out = html
  const wrap = (prefix: string) => (_m: string, c: string) => `\n\n${prefix} ${stripTags(c).trim()}\n\n`
  // Headings
  out = out.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, wrap('#'))
  out = out.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, wrap('##'))
  out = out.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, wrap('###'))
  out = out.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, wrap('####'))
  out = out.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, wrap('#####'))
  out = out.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, wrap('######'))
  // Lists
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, c: string) => `\n- ${stripTags(c).trim()}`)
  out = out.replace(/<\/?(ul|ol)[^>]*>/gi, '\n')
  // Paragraphs and breaks
  out = out.replace(/<br\s*\/?>(?!\n)/gi, '\n')
  out = out.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m: string, c: string) => `\n\n${stripTags(c).trim()}\n\n`)
  // Bold/italic
  out = out.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m: string, _t: string, c: string) => `**${stripTags(c)}**`)
  out = out.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m: string, _t: string, c: string) => `*${stripTags(c)}*`)
  // Tables: rough conversion
  out = out.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m: string, c: string) => {
    const cellMatches = Array.from(c.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi))
    const cells = cellMatches.map((cm) => stripTags(cm[1] ?? '').trim())
    return `\n| ${cells.join(' | ')} |`
  })
  out = out.replace(/<\/?(table|thead|tbody|tfoot)[^>]*>/gi, '\n')
  // Strip remaining tags
  out = stripTags(out)
  // Decode HTML entities
  out = decodeEntities(out)
  // Collapse excess newlines
  out = out.replace(/\n{3,}/g, '\n\n')
  return out
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
}

function splitOnHeaders(markdown: string): ParsedSegment[] {
  const lines = markdown.split('\n')
  const segments: ParsedSegment[] = []
  let currentLabel = 'Introduction'
  let currentLevel = 0
  let buffer: string[] = []

  const flush = () => {
    const content = buffer.join('\n').trim()
    if (content.length > 0) {
      segments.push({
        label: currentLabel,
        content,
        metadata: { headingLevel: currentLevel },
      })
    }
    buffer = []
  }

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headerMatch) {
      flush()
      currentLevel = headerMatch[1].length
      currentLabel = headerMatch[2].trim()
    } else {
      buffer.push(line)
    }
  }
  flush()

  if (segments.length === 0 && markdown.trim().length > 0) {
    segments.push({
      label: 'Content',
      content: markdown.trim(),
      metadata: {},
    })
  }
  return segments
}
