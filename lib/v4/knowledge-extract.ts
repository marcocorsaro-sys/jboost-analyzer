/**
 * V4 — knowledge document text extraction (Sprint 2 item 18, Bibbia 04
 * field #23).
 *
 * The setup accepts "knowledge documents" (brief di gara, brand book, linee
 * guida) whose declared purpose is to contextualize the AI insights — but
 * until this sprint the uploads were stored and NEVER read by any prompt.
 *
 * This module is the PURE half of the honest fix: text normalization,
 * truncation to a per-document budget, format capability lookup, and the
 * prompt-section builder the orchestrator appends to every insight call.
 * The impure half (pdf-parse / mammoth dynamic imports on the upload buffer)
 * lives in the files route, which already hosts the other upload parsers.
 *
 * No new dependency: .txt/.md/.csv are decoded directly; .pdf uses the
 * pdf-parse already in package.json; .docx uses the mammoth already in
 * package.json. Everything else (.doc, .pptx, .xlsx, .xls) is accepted as an
 * upload but marked "not readable by the model", and the UI says so.
 */

/** Per-document extract budget, in characters (~2k tokens per doc). */
export const KNOWLEDGE_EXTRACT_BUDGET = 8000

/** Formats whose text this codebase can extract without new dependencies. */
export type KnowledgeExtractKind = 'text' | 'pdf' | 'docx'

/** null = format accepted but not extractable (the UI explains it). */
export function knowledgeExtractKind(ext: string): KnowledgeExtractKind | null {
  const e = ext.toLowerCase()
  if (e === '.txt' || e === '.md' || e === '.csv') return 'text'
  if (e === '.pdf') return 'pdf'
  if (e === '.docx') return 'docx'
  return null
}

/**
 * Decode a text-format upload buffer: UTF-16 LE/BE BOMs are honoured (some
 * exports ship them), everything else is read as UTF-8, and a leading UTF-8
 * BOM is stripped.
 */
export function decodeTextBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    // UTF-16 BE: swap byte pairs, then read as LE.
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return text
}

/**
 * Normalize extracted text so the prompt budget buys signal, not whitespace:
 * CRLF -> LF, NULs and control noise out, runs of blank lines collapsed.
 */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface TruncatedExtract {
  text: string
  truncated: boolean
  /** Length of the normalized text BEFORE truncation. */
  chars: number
}

/**
 * Truncate a normalized extract to the budget, cutting at a word boundary
 * near the limit so the model never receives half a word as the last token.
 */
export function truncateExtract(text: string, budget = KNOWLEDGE_EXTRACT_BUDGET): TruncatedExtract {
  const normalized = normalizeExtractedText(text)
  if (normalized.length <= budget) {
    return { text: normalized, truncated: false, chars: normalized.length }
  }
  let cut = normalized.slice(0, budget)
  const lastSpace = cut.lastIndexOf(' ')
  if (lastSpace > budget * 0.8) cut = cut.slice(0, lastSpace)
  return { text: cut.trimEnd(), truncated: true, chars: normalized.length }
}

/** One knowledge document as the orchestrator reads it from v4_setup. */
export interface KnowledgeDoc {
  name: string
  /** Extracted text (already truncated at upload); null = not extractable. */
  text: string | null
  truncated?: boolean
}

/**
 * The knowledge documents of an analysis setup: attachments of kind
 * 'knowledge_doc'. Docs without extracted text are still listed (name only)
 * so the caller can say they exist without pretending to have read them.
 */
export function readKnowledgeDocs(
  v4Setup: Record<string, unknown> | null | undefined,
): KnowledgeDoc[] {
  const raw = v4Setup?.attachments
  if (!Array.isArray(raw)) return []
  const out: KnowledgeDoc[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const att = a as { kind?: unknown; name?: unknown; extracted_text?: unknown; extract_truncated?: unknown }
    if (att.kind !== 'knowledge_doc') continue
    out.push({
      name: typeof att.name === 'string' ? att.name : 'documento',
      text:
        typeof att.extracted_text === 'string' && att.extracted_text.trim() !== ''
          ? att.extracted_text
          : null,
      truncated: att.extract_truncated === true,
    })
  }
  return out
}

/**
 * The knowledge_documents section appended to every insight user prompt
 * (drivers AND Executive Summary). Empty when nothing readable was uploaded:
 * the prompt stays byte-identical to the sheet text.
 *
 * The instruction is explicit about HOW to use the content — calibrate, do
 * not quote wholesale — with special mention of Content, per item 18.
 */
export function knowledgeDocumentsClause(docs: KnowledgeDoc[]): string {
  const readable = docs.filter((d): d is KnowledgeDoc & { text: string } => d.text !== null)
  if (readable.length === 0) return ''
  const parts = readable.map(
    (d) =>
      `--- DOCUMENT: ${d.name}${d.truncated ? ' (excerpt, truncated)' : ''} ---\n${d.text}`,
  )
  return (
    `\n\nKNOWLEDGE DOCUMENTS (uploaded by the analyst in setup: briefs, brand books, guidelines). ` +
    `Use them to CALIBRATE your comments and recommendations, especially for the Content driver: ` +
    `respect the tone of voice, constraints and priorities they state, and prefer suggestions ` +
    `consistent with them. Do not quote them wholesale and do not invent numbers from them.\n` +
    parts.join('\n')
  )
}
