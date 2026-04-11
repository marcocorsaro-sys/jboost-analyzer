import { createClient } from '@/lib/supabase/server'

// Pricing per 1M tokens (USD) — update as prices change
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
}

export interface TrackLlmUsageParams {
  userId: string
  clientId?: string | null
  provider: 'anthropic' | 'openai'
  model: string
  operation: string
  inputTokens: number
  outputTokens: number
  metadata?: Record<string, unknown>
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = PRICING[model]
  if (!rates) return 0
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000
}

/**
 * Track LLM API usage. Non-blocking — never throws.
 */
export async function trackLlmUsage(params: TrackLlmUsageParams): Promise<void> {
  try {
    const supabase = await createClient()
    const cost = estimateCost(params.model, params.inputTokens, params.outputTokens)

    await supabase.from('llm_usage').insert({
      user_id: params.userId,
      client_id: params.clientId || null,
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      estimated_cost_usd: cost,
      metadata: params.metadata || null,
    })
  } catch (err) {
    console.error('[trackLlmUsage] Failed:', err)
  }
}
