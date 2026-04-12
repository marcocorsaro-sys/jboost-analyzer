import type { ParsedDocument, ParsedSegment } from '../types'

interface SlideContent {
  index: number
  text: string
  notes: string
}

interface JsZipFile {
  async(type: 'string'): Promise<string>
}

interface JsZipInstance {
  files: Record<string, JsZipFile>
  loadAsync(data: Buffer): Promise<JsZipInstance>
}

type JsZipCtor = new () => JsZipInstance

function resolveJsZipCtor(mod: unknown): JsZipCtor {
  if (typeof mod === 'function') return mod as JsZipCtor
  if (mod && typeof mod === 'object') {
    const def = (mod as { default?: unknown }).default
    if (typeof def === 'function') return def as JsZipCtor
    if (def && typeof def === 'object' && typeof (def as { default?: unknown }).default === 'function') {
      return (def as { default: unknown }).default as JsZipCtor
    }
  }
  throw new Error('Failed to resolve JSZip constructor from module')
}

export async function parsePptx(buffer: Buffer): Promise<ParsedDocument> {
  // jszip ships ESM/CJS interop hazards; resolve the constructor robustly.
  const JSZipMod: unknown = await import('jszip')
  const JSZipCtor = resolveJsZipCtor(JSZipMod)
  const zip = await new JSZipCtor().loadAsync(buffer)

  const slides = new Map<number, SlideContent>()

  const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/
  const notesRegex = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/

  const fileEntries = Object.keys(zip.files)

  for (const path of fileEntries) {
    const slideMatch = path.match(slideRegex)
    if (slideMatch) {
      const idx = parseInt(slideMatch[1], 10)
      const xml = await zip.files[path].async('string')
      const text = extractTextFromXml(xml)
      const existing = slides.get(idx)
      slides.set(idx, {
        index: idx,
        text,
        notes: existing?.notes ?? '',
      })
    }
  }

  for (const path of fileEntries) {
    const notesMatch = path.match(notesRegex)
    if (notesMatch) {
      const idx = parseInt(notesMatch[1], 10)
      const xml = await zip.files[path].async('string')
      const notes = extractTextFromXml(xml)
      const existing = slides.get(idx)
      if (existing) {
        existing.notes = notes
      } else {
        slides.set(idx, { index: idx, text: '', notes })
      }
    }
  }

  const ordered = Array.from(slides.values()).sort((a, b) => a.index - b.index)

  const segments: ParsedSegment[] = ordered
    .map((s) => {
      const parts: string[] = []
      if (s.text.trim().length > 0) parts.push(s.text.trim())
      if (s.notes.trim().length > 0) parts.push(`Speaker notes:\n${s.notes.trim()}`)
      const content = parts.join('\n\n')
      return {
        label: `Slide ${s.index}`,
        content,
        metadata: {
          slideIndex: s.index,
          hasNotes: s.notes.trim().length > 0,
        },
      }
    })
    .filter((seg) => seg.content.length > 0)

  const rawText = segments
    .map((s) => `## ${s.label}\n\n${s.content}`)
    .join('\n\n')
    .trim()

  return {
    rawText,
    segments,
    metadata: {
      slideCount: ordered.length,
    },
  }
}

function extractTextFromXml(xml: string): string {
  // OpenXML stores visible text inside <a:t>...</a:t>. Paragraphs are <a:p>.
  const paragraphs: string[] = []
  const paragraphRegex = /<a:p[^>]*>([\s\S]*?)<\/a:p>/g
  let pMatch: RegExpExecArray | null
  while ((pMatch = paragraphRegex.exec(xml)) !== null) {
    const inner = pMatch[1]
    const runRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    const runs: string[] = []
    let rMatch: RegExpExecArray | null
    while ((rMatch = runRegex.exec(inner)) !== null) {
      runs.push(decodeXmlEntities(rMatch[1]))
    }
    const line = runs.join('').trim()
    if (line.length > 0) paragraphs.push(line)
  }
  // Fallback: if no <a:p> structure, just extract <a:t> directly
  if (paragraphs.length === 0) {
    const runRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    let rMatch: RegExpExecArray | null
    while ((rMatch = runRegex.exec(xml)) !== null) {
      const t = decodeXmlEntities(rMatch[1]).trim()
      if (t.length > 0) paragraphs.push(t)
    }
  }
  return paragraphs.join('\n')
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
}
