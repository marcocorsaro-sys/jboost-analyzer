export interface ParsedSegment {
  label: string
  content: string
  metadata?: Record<string, unknown>
}

export interface ParsedDocument {
  rawText: string
  segments: ParsedSegment[]
  metadata: Record<string, unknown>
}

export interface Chunk {
  index: number
  content: string
  tokenCount: number
  metadata: Record<string, unknown>
}

export type KnowledgeSourceType =
  | 'file_pdf'
  | 'file_docx'
  | 'file_xlsx'
  | 'file_pptx'
  | 'file_txt'
  | 'transcript_teams'
  | 'transcript_generic'
  | 'note_manual'
  | 'email'
  | 'web_clip'
  | 'ask_j_artifact'

export interface IngestInput {
  clientId: string
  userId: string
  sourceType: KnowledgeSourceType
  sourceName: string
  storagePath?: string
  fileBuffer?: Buffer
  rawText?: string
  metadata?: Record<string, unknown>
}

export interface IngestResult {
  documentId: string
  status: 'ready' | 'failed'
  chunkCount?: number
  tokenCount?: number
  error?: string
}

export interface ParseDocumentInput {
  sourceType: KnowledgeSourceType
  sourceName: string
  fileBuffer?: Buffer
  rawText?: string
}
