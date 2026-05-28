import { createClient } from '@/lib/supabase/server'
import { estimateCost } from './pricing'

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

/**
 * Track LLM API usage. Non-blocking — never throws.
 * Cost estimation lives in lib/tracking/pricing.ts so new model IDs only
 * need to land there for the cost dashboard + spend limit to stay accurate.
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

// Re-export so callers don't reach into pricing.ts directly.
export { estimateCost } from './pricing'
