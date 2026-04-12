import type { Chunk } from './types'

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'
const EMBEDDING_MODEL = 'text-embedding-3-small'
const BATCH_SIZE = 100
const MAX_RETRIES = 3

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[]
  model: string
  usage?: { prompt_tokens: number; total_tokens: number }
}

export async function embedChunks(chunks: Chunk[]): Promise<number[][]> {
  if (chunks.length === 0) return []
  const inputs = chunks.map((c) => c.content)
  return embedInputs(inputs)
}

export async function embedQuery(query: string): Promise<number[]> {
  const trimmed = (query ?? '').trim()
  if (!trimmed) {
    throw new Error('embedQuery called with empty query')
  }
  const out = await embedInputs([trimmed])
  return out[0]
}

async function embedInputs(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set; cannot generate embeddings')
  }

  const results: number[][] = new Array(inputs.length)

  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const slice = inputs.slice(start, start + BATCH_SIZE)
    const response = await callWithRetry(apiKey, slice)
    // OpenAI returns items with index relative to the request input array
    for (const item of response.data) {
      results[start + item.index] = item.embedding
    }
  }

  // Sanity check: every slot should be filled
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      throw new Error(`Embedding response missing item at index ${i}`)
    }
  }
  return results
}

async function callWithRetry(apiKey: string, inputs: string[]): Promise<OpenAIEmbeddingResponse> {
  let attempt = 0
  let lastErr: unknown = null
  while (attempt < MAX_RETRIES) {
    attempt++
    try {
      const res = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: inputs,
        }),
      })

      if (res.status === 429 || res.status >= 500) {
        const text = await safeReadText(res)
        lastErr = new Error(`OpenAI embeddings ${res.status}: ${text}`)
        const backoff = Math.min(8000, 500 * Math.pow(2, attempt - 1))
        await sleep(backoff)
        continue
      }

      if (!res.ok) {
        const text = await safeReadText(res)
        throw new Error(`OpenAI embeddings ${res.status}: ${text}`)
      }

      const json = (await res.json()) as OpenAIEmbeddingResponse
      if (!json?.data || !Array.isArray(json.data)) {
        throw new Error('Invalid OpenAI embeddings response shape')
      }
      return json
    } catch (err) {
      lastErr = err
      if (attempt >= MAX_RETRIES) break
      const backoff = Math.min(8000, 500 * Math.pow(2, attempt - 1))
      await sleep(backoff)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Failed to call OpenAI embeddings')
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
