import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { ingestDocument } from '../lib/knowledge/ingest'
import { embedQuery } from '../lib/knowledge/embedding'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { KnowledgeSourceType } from '../lib/knowledge/types'

interface CliArgs {
  file: string
  client: string
  user?: string
  query?: string
  type?: KnowledgeSourceType
}

function parseArgs(): CliArgs {
  const args: Record<string, string> = {}
  for (const raw of process.argv.slice(2)) {
    const m = raw.match(/^--([^=]+)=(.*)$/)
    if (m) args[m[1]] = m[2]
  }
  if (!args.file || !args.client) {
    console.error('Usage: tsx scripts/test-ingest.ts --file=path/to/file.pdf --client=<client_uuid> [--user=<user_uuid>] [--type=file_pdf] [--query="search query"]')
    process.exit(1)
  }
  return {
    file: args.file,
    client: args.client,
    user: args.user,
    query: args.query,
    type: (args.type as KnowledgeSourceType | undefined) ?? undefined,
  }
}

function inferType(filename: string): KnowledgeSourceType {
  const ext = extname(filename).toLowerCase()
  if (ext === '.pdf') return 'file_pdf'
  if (ext === '.docx' || ext === '.doc') return 'file_docx'
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') return 'file_xlsx'
  if (ext === '.pptx' || ext === '.ppt') return 'file_pptx'
  if (ext === '.vtt') return 'transcript_teams'
  return 'file_txt'
}

async function main() {
  const args = parseArgs()

  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set')
    process.exit(1)
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set')
    process.exit(1)
  }

  const buffer = await readFile(args.file)
  const sourceName = basename(args.file)
  const sourceType = args.type ?? inferType(sourceName)
  const userId = args.user ?? '00000000-0000-0000-0000-000000000000'

  console.log(`\n=== Ingesting ${sourceName} (${sourceType}) ===`)
  console.log(`Client:  ${args.client}`)
  console.log(`User:    ${userId}`)
  console.log(`Bytes:   ${buffer.length}\n`)

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const start = Date.now()
  const result = await ingestDocument(
    {
      clientId: args.client,
      userId,
      sourceType,
      sourceName,
      fileBuffer: buffer,
    },
    supabase
  )
  const elapsed = Math.round((Date.now() - start) / 100) / 10

  console.log(`Status:    ${result.status}`)
  console.log(`Document:  ${result.documentId}`)
  console.log(`Chunks:    ${result.chunkCount ?? '-'}`)
  console.log(`Tokens:    ${result.tokenCount ?? '-'}`)
  console.log(`Elapsed:   ${elapsed}s`)
  if (result.error) {
    console.log(`Error:     ${result.error}`)
  }

  if (result.status !== 'ready') {
    process.exit(1)
  }

  // Run a sample search reusing the same supabase client.
  const sample = args.query ?? 'summary key insights'
  console.log(`\n=== Sample search: "${sample}" ===\n`)

  const embedding = await embedQuery(sample)
  const embeddingLiteral = `[${embedding.join(',')}]`

  const { data, error } = await supabase.rpc('search_knowledge_chunks', {
    p_client_id: args.client,
    p_query_embedding: embeddingLiteral,
    p_limit: 3,
  })

  if (error) {
    console.error(`Search RPC error: ${error.message}`)
    process.exit(1)
  }

  const rows = (data ?? []) as Array<{
    id: string
    document_id: string
    chunk_index: number
    content: string
    similarity: number
  }>

  if (rows.length === 0) {
    console.log('(no results — RLS may be blocking anon access; run via a real session)')
    return
  }

  rows.forEach((r, i) => {
    const preview = r.content.replace(/\s+/g, ' ').slice(0, 200)
    console.log(`${i + 1}. similarity=${r.similarity.toFixed(3)}  chunk=${r.chunk_index}`)
    console.log(`   ${preview}${r.content.length > 200 ? '...' : ''}\n`)
  })
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.stack : err)
  process.exit(1)
})
