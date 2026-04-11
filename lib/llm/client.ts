/**
 * LLM client with OpenAI primary and Perplexity fallback.
 * Used by the Edge Function for analysis pipeline.
 */

interface LlmOptions {
  prompt: string
  systemPrompt?: string
  jsonSchema?: Record<string, unknown>
  temperature?: number
  topP?: number
}

interface LlmResponse {
  content: string
  provider: 'openai' | 'perplexity'
}

const SYSTEM_PROMPT_BASE = `You are an analytical assistant used for SEO/GEO and business analysis.`

const JSON_INSTRUCTION = `When responding, you MUST output only valid JSON (no markdown, no commentary). The JSON MUST strictly conform to the provided schema and must not include any additional wrapper properties.`

export async function callLlm(options: LlmOptions): Promise<LlmResponse> {
  const { prompt, systemPrompt, jsonSchema, temperature = 0.2, topP = 0.9 } = options

  const system = [
    systemPrompt || SYSTEM_PROMPT_BASE,
    jsonSchema ? `${JSON_INSTRUCTION}\n\nSchema:\n${JSON.stringify(jsonSchema)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  // Try OpenAI first
  const openaiKey = process.env.OPENAI_API_KEY || process.env.OPEN_AI_API_KEY
  if (openaiKey) {
    try {
      const result = await callOpenAI(openaiKey, system, prompt, temperature, topP, jsonSchema)
      return { content: result, provider: 'openai' }
    } catch (err) {
      console.warn('[LLM] OpenAI failed, trying Perplexity fallback:', err)
    }
  }

  // Fallback to Perplexity
  const pplxKey = process.env.PPLX_API_KEY
  if (pplxKey) {
    try {
      const result = await callPerplexity(pplxKey, system, prompt, temperature, topP)
      return { content: result, provider: 'perplexity' }
    } catch (err) {
      console.error('[LLM] Perplexity also failed:', err)
      throw new Error('All LLM providers failed')
    }
  }

  throw new Error('No LLM API key configured (OPENAI_API_KEY or PPLX_API_KEY)')
}

async function callOpenAI(
  apiKey: string,
  system: string,
  prompt: string,
  temperature: number,
  topP: number,
  jsonSchema?: Record<string, unknown>
): Promise<string> {
  const body: Record<string, unknown> = {
    model: 'gpt-4-turbo',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature,
    top_p: topP,
    stream: false,
  }

  if (jsonSchema) {
    body.response_format = { type: 'json_object' }
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenAI ${res.status}: ${text}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

async function callPerplexity(
  apiKey: string,
  system: string,
  prompt: string,
  temperature: number,
  topP: number
): Promise<string> {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature,
      top_p: topP,
      stream: false,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Perplexity ${res.status}: ${text}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

/** Parse JSON from LLM response, handling markdown code blocks */
export function parseLlmJson<T>(content: string): T {
  let cleaned = content.trim()
  // Remove markdown code blocks if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  return JSON.parse(cleaned) as T
}
