// ============================================================
// JBoost — Client Memory: knowledge RAG retrieval (Phase 5B)
//
// Replaces the old "truncate every file at 5K chars" approach with a
// semantic-search-driven retrieval over the Phase 3 knowledge_chunks
// table. We run a fixed list of "pivot questions" that cover all the
// memory categories (business, competitor, budget, ...), embed each
// one via OpenAI text-embedding-3-small (the same model used by
// ingestion so the vectors are comparable), call the
// search_knowledge_chunks RPC, dedupe by chunk_id, and return a single
// markdown block grouped by source document.
//
// The result is a much more focused prompt for the memory synthesizer:
// instead of feeding the first 5K chars of each document blindly, we
// feed the chunks that are actually relevant to the kinds of questions
// a memory should answer. Document-grounded, no hallucination, scales
// to PDFs of arbitrary size.
//
// Falls back to a no-op (returning the empty result) if the Phase 3
// migration isn't applied yet or the OpenAI key is missing — the
// assembler then keeps the legacy client_files path as a safety net.
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js'
import { embedQuery } from '@/lib/knowledge/embedding'

/**
 * Pivot questions used to drive the semantic retrieval over the client's
 * knowledge base. Each question targets one of the memory profile
 * dimensions (business, competitor, budget, audience, technology, ...).
 *
 * Italian, because the synthesis prompt is in Italian and the chunks of
 * the documents we ingest are most often in Italian too. The embedding
 * model is multilingual so this works for English documents as well.
 */
const PIVOT_QUERIES: { id: string; q: string }[] = [
  { id: 'business_goals', q: 'Quali sono gli obiettivi di business e i KPI principali del cliente?' },
  { id: 'competitors', q: 'Chi sono i competitor diretti del cliente e come si posizionano?' },
  { id: 'budget', q: 'Qual è il budget marketing o il range di investimento del cliente?' },
  { id: 'challenges', q: 'Quali sono le sfide, i problemi e i pain point attuali del cliente?' },
  { id: 'tools', q: 'Quali tecnologie, piattaforme, CMS, CRM e tool digitali usa il cliente?' },
  { id: 'audience', q: 'Quali sono i target audience, i segmenti di clientela e i buyer persona?' },
  { id: 'product', q: 'Qual è il prodotto o il servizio principale offerto dal cliente?' },
  { id: 'markets', q: 'In quali mercati geografici, paesi e regioni opera il cliente?' },
  { id: 'team', q: 'Chi sono le persone chiave del team del cliente e quali sono i loro ruoli?' },
  { id: 'content', q: 'Quali sono le strategie di contenuto, i canali editoriali e il tone of voice del cliente?' },
  { id: 'social', q: 'Qual è la presenza sui social media e i canali digitali del cliente?' },
  { id: 'history', q: 'Quali sono i risultati storici di SEO, SEM e marketing digitale del cliente?' },
  { id: 'timeline', q: 'Quali sono le scadenze, le milestone e i timeline di progetto del cliente?' },
  { id: 'preferences', q: 'Quali sono le preferenze di comunicazione, reportistica e collaborazione del cliente?' },
  { id: 'differentiator', q: 'Cosa rende unico, differenziato o distintivo il cliente rispetto al mercato?' },
]

const TOP_K_PER_PIVOT = 3
/** Total budget across all chunks, in characters. ~6K tokens. */
const TOTAL_BUDGET_CHARS = 25_000
/** Maximum chunks we keep per source document so a single doc can't dominate. */
const MAX_CHUNKS_PER_DOCUMENT = 6

interface ChunkRow {
  id: string
  document_id: string
  chunk_index: number
  content: string
  metadata: Record<string, unknown> | null
  similarity: number
}

interface DocumentRow {
  id: string
  source_name: string
  source_type: string
  created_at: string
}

export interface KnowledgeRagResult {
  /** Markdown text block ready to splice into the memory assembler prompt. */
  text: string
  /** Total characters of the text block. */
  totalChars: number
  /** Stable IDs of all unique chunks selected. */
  chunkIds: string[]
  /** Stable IDs of all unique source documents touched. */
  documentIds: string[]
  /** Number of chunks the assembler chose to drop because of the budget. */
  droppedChunks: number
  /** True if the RAG path actually ran. False if it was skipped (no embedding key, RPC error). */
  usedRag: boolean
  /** Last error encountered (the function does NOT throw — it degrades gracefully). */
  error: string | null
}

const EMPTY_RESULT: KnowledgeRagResult = {
  text: '',
  totalChars: 0,
  chunkIds: [],
  documentIds: [],
  droppedChunks: 0,
  usedRag: false,
  error: null,
}

/**
 * Run the pivot queries against the Phase 3 vector index and return a
 * formatted text block ready to splice into the memory synthesizer prompt.
 *
 * Never throws — returns { usedRag: false, error: ... } on any failure so
 * the caller can fall back to the legacy client_files path.
 */
export async function assembleKnowledgeViaRAG(
  clientId: string,
  supabase: SupabaseClient
): Promise<KnowledgeRagResult> {
  // Bail early if the embedding key is missing — we can't run RAG without it.
  if (!process.env.OPENAI_API_KEY) {
    return { ...EMPTY_RESULT, error: 'OPENAI_API_KEY not configured' }
  }

  // 1. Fetch the list of documents up front so we can format the output
  // grouped by document name. Also tells us if the client has any
  // ingested knowledge at all.
  const { data: documents, error: docsError } = await supabase
    .from('knowledge_documents')
    .select('id, source_name, source_type, created_at, ingestion_status')
    .eq('client_id', clientId)
    .eq('ingestion_status', 'ready')
    .order('created_at', { ascending: false })

  if (docsError) {
    // Most common reason: the table doesn't exist yet (Phase 1B not
    // applied) or RLS rejected the query. Either way, fall back.
    return { ...EMPTY_RESULT, error: docsError.message }
  }

  if (!documents || documents.length === 0) {
    // No ingested knowledge for this client — nothing to retrieve.
    return { ...EMPTY_RESULT, usedRag: true }
  }

  const docMap = new Map<string, DocumentRow>(
    documents.map(d => [d.id, d as DocumentRow])
  )

  // 2. Embed all pivot queries in parallel. embedQuery batches via OpenAI
  // so this is one HTTP roundtrip per query, but we run them concurrently.
  // Limit concurrency to 5 so we don't fan out too aggressively.
  const concurrency = 5
  const queryEmbeddings: { id: string; q: string; embedding: number[] | null }[] = []

  for (let i = 0; i < PIVOT_QUERIES.length; i += concurrency) {
    const batch = PIVOT_QUERIES.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async pivot => {
        try {
          const embedding = await embedQuery(pivot.q)
          return { ...pivot, embedding }
        } catch (err) {
          console.warn(`[memory-rag] embed failed for "${pivot.id}":`, err)
          return { ...pivot, embedding: null }
        }
      })
    )
    queryEmbeddings.push(...results)
  }

  const validQueries = queryEmbeddings.filter(q => q.embedding !== null)
  if (validQueries.length === 0) {
    return {
      ...EMPTY_RESULT,
      error: 'All pivot embeddings failed (OpenAI unreachable?)',
    }
  }

  // 3. Run the search_knowledge_chunks RPC for each pivot in parallel.
  // We collect all chunks, then dedupe by chunk id and re-rank.
  const allChunks: (ChunkRow & { matchedPivots: string[] })[] = []
  const chunkSeen = new Map<string, ChunkRow & { matchedPivots: string[] }>()

  await Promise.all(
    validQueries.map(async pivot => {
      const literal = `[${pivot.embedding!.join(',')}]`
      const { data, error } = await supabase.rpc('search_knowledge_chunks', {
        p_client_id: clientId,
        p_query_embedding: literal,
        p_limit: TOP_K_PER_PIVOT,
      })

      if (error || !data) {
        console.warn(`[memory-rag] rpc failed for pivot ${pivot.id}:`, error)
        return
      }

      for (const row of data as ChunkRow[]) {
        const existing = chunkSeen.get(row.id)
        if (existing) {
          existing.matchedPivots.push(pivot.id)
          // Keep the highest similarity score across pivots.
          if (row.similarity > existing.similarity) {
            existing.similarity = row.similarity
          }
        } else {
          const enriched = { ...row, matchedPivots: [pivot.id] }
          chunkSeen.set(row.id, enriched)
          allChunks.push(enriched)
        }
      }
    })
  )

  if (allChunks.length === 0) {
    // The vector index returned nothing for any pivot — likely the chunks
    // aren't embedded yet. Tell the caller so it can fall back.
    return {
      ...EMPTY_RESULT,
      usedRag: true,
      error: 'No chunks matched the pivot queries (knowledge_chunks empty?)',
    }
  }

  // 4. Re-rank: highest similarity first, then alphabetical by chunk id
  // for determinism. Apply per-document and total budget caps.
  allChunks.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity
    return a.id.localeCompare(b.id)
  })

  const perDocCount: Record<string, number> = {}
  const selected: typeof allChunks = []
  let totalChars = 0
  let droppedChunks = 0

  for (const chunk of allChunks) {
    if ((perDocCount[chunk.document_id] ?? 0) >= MAX_CHUNKS_PER_DOCUMENT) {
      droppedChunks++
      continue
    }
    if (totalChars + chunk.content.length > TOTAL_BUDGET_CHARS) {
      droppedChunks++
      continue
    }
    selected.push(chunk)
    perDocCount[chunk.document_id] = (perDocCount[chunk.document_id] ?? 0) + 1
    totalChars += chunk.content.length
  }

  // 5. Group the selected chunks by document_id, sort each group by
  // chunk_index, and emit a single markdown block.
  const grouped = new Map<string, typeof selected>()
  for (const chunk of selected) {
    const list = grouped.get(chunk.document_id) ?? []
    list.push(chunk)
    grouped.set(chunk.document_id, list)
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.chunk_index - b.chunk_index)
  }

  const lines: string[] = []
  lines.push('# KNOWLEDGE BASE — RILEVANTI ESTRATTI (Phase 5B RAG)')
  lines.push(
    `Estratti rilevanti da ${grouped.size} documento/i tramite ricerca semantica.`
  )
  if (droppedChunks > 0) {
    lines.push(
      `[${droppedChunks} chunk omessi per limiti di budget — i piu' rilevanti restano sotto]`
    )
  }
  lines.push('')

  // Stable order: most recent document first.
  const orderedDocIds = Array.from(grouped.keys()).sort((a, b) => {
    const da = docMap.get(a)?.created_at ?? ''
    const db = docMap.get(b)?.created_at ?? ''
    return db.localeCompare(da)
  })

  for (const docId of orderedDocIds) {
    const doc = docMap.get(docId)
    const chunks = grouped.get(docId)!
    const docLabel = doc?.source_name ?? `documento ${docId.slice(0, 8)}`
    const docType = doc?.source_type ?? '?'
    const docDate = doc?.created_at
      ? new Date(doc.created_at).toLocaleDateString('it-IT', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : ''
    lines.push(`## ${docLabel}  [${docType}${docDate ? ' — ' + docDate : ''}]`)
    for (const c of chunks) {
      const pivots = c.matchedPivots.slice(0, 3).join(', ')
      const sim = (c.similarity * 100).toFixed(0)
      lines.push(
        `### chunk ${c.chunk_index}  (rilevante per: ${pivots}; similarity ${sim}%)`
      )
      lines.push(c.content.trim())
      lines.push('')
    }
  }

  return {
    text: lines.join('\n'),
    totalChars,
    chunkIds: selected.map(c => c.id),
    documentIds: Array.from(grouped.keys()),
    droppedChunks,
    usedRag: true,
    error: null,
  }
}
