import type { ParseDocumentInput, ParsedDocument } from '../types'
import { parsePdf } from './pdf'
import { parseDocx } from './docx'
import { parseXlsx } from './xlsx'
import { parsePptx } from './pptx'
import { parseTxt } from './txt'
import { parseTranscriptTeams } from './transcript-teams'
import { parseTranscriptGeneric } from './transcript-generic'

export async function parseDocument(input: ParseDocumentInput): Promise<ParsedDocument> {
  const { sourceType, fileBuffer, rawText } = input

  if (sourceType === 'note_manual' || sourceType === 'email' || sourceType === 'web_clip' || sourceType === 'ask_j_artifact') {
    const text = (rawText ?? '').trim()
    return {
      rawText: text,
      segments: text.length ? [{ label: 'Content', content: text, metadata: {} }] : [],
      metadata: { sourceType },
    }
  }

  if (!fileBuffer) {
    throw new Error(`fileBuffer is required for sourceType=${sourceType}`)
  }

  switch (sourceType) {
    case 'file_pdf':
      return parsePdf(fileBuffer)
    case 'file_docx':
      return parseDocx(fileBuffer)
    case 'file_xlsx':
      return parseXlsx(fileBuffer)
    case 'file_pptx':
      return parsePptx(fileBuffer)
    case 'file_txt':
      return parseTxt(fileBuffer)
    case 'transcript_teams':
      return parseTranscriptTeams(fileBuffer)
    case 'transcript_generic':
      return parseTranscriptGeneric(fileBuffer)
    default: {
      const _exhaustive: never = sourceType
      throw new Error(`Unsupported sourceType: ${_exhaustive as string}`)
    }
  }
}
