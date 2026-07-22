/**
 * LLM model pricing (USD per 1M tokens).
 *
 * Source of truth for cost estimates. New model IDs land here as Anthropic
 * and OpenAI ship updates; the prefix fallback keeps us approximately right
 * even before this file is patched.
 */

export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number
  /** USD per 1M output tokens. */
  output: number
}

const EXACT: Record<string, ModelPricing> = {
  // Anthropic — Claude 4.x family
  'claude-opus-4-8': { input: 15, output: 75 },
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  // Retired 2026-06-15. Kept: historical llm_usage rows still carry this id.
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-haiku-4-5': { input: 1, output: 5 },

  // OpenAI
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4o': { input: 5, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-5': { input: 2.5, output: 10 },
}

/**
 * Best-guess fallback for unknown model IDs that follow a known family prefix.
 * Order matters — most specific prefixes first. The fallback keeps cost
 * tracking approximately correct when a new model ID ships before this
 * pricing file gets updated.
 */
const PREFIX_FALLBACK: { prefix: string; pricing: ModelPricing }[] = [
  { prefix: 'claude-opus', pricing: { input: 15, output: 75 } },
  { prefix: 'claude-sonnet', pricing: { input: 3, output: 15 } },
  { prefix: 'claude-haiku', pricing: { input: 1, output: 5 } },
  { prefix: 'gpt-4o-mini', pricing: { input: 0.15, output: 0.6 } },
  { prefix: 'gpt-4o', pricing: { input: 5, output: 15 } },
  { prefix: 'gpt-4', pricing: { input: 10, output: 30 } },
]

export function priceOf(model: string): ModelPricing | null {
  if (EXACT[model]) return EXACT[model]
  for (const f of PREFIX_FALLBACK) {
    if (model.startsWith(f.prefix)) return f.pricing
  }
  return null
}

/** Estimated USD cost for a single LLM call. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model)
  if (!p) return 0
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}
