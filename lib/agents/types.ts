// Co-pilot agent framework — PR1 fondamenta.
//
// Every "driver" of the analysis (the 9 scoring drivers + MarTech)
// can be modeled as an Agent: it has a methodology, an execute() that
// produces an output + evidence, and a sibling Quality agent (Anthropic)
// that judges whether the output is good enough or needs a retry with
// explicit guidance. The orchestrator runs the loop (execute → quality
// → maybe retry → return) bounded by a max-retries budget.
//
// This file is intentionally framework-only — concrete agents (AI
// Relevance, MarTech) live alongside, and the existing deterministic
// drivers keep working untouched until wrapped agent-by-agent in
// follow-up PRs.

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface AgentRunResult<TOutput> {
  output: TOutput;
  /** Concrete signals / values the agent relied on. Used both for
   *  user-facing transparency and for the quality agent's review. */
  evidence: string[];
  /** Cumulative LLM cost incurred by this execution (best effort). */
  usage?: TokenUsage;
  /** Cost in USD, when known. */
  cost_usd?: number;
  /** Free-form notes the agent wants to surface (warnings, fallbacks). */
  notes?: string[];
}

export type QualityVerdictKind = 'pass' | 'retry' | 'fail';

export interface QualityVerdict {
  verdict: QualityVerdictKind;
  /** 0..100 — quality score the judge assigned. */
  score: number;
  /** Concrete issues the judge spotted. Always populated except on pass. */
  issues: string[];
  /** When verdict='retry', explicit instructions for the next run. The
   *  agent is expected to read this and adjust its execute() behavior. */
  guidance: string;
  /** Anthropic model used by the judge. */
  model?: string;
  /** Set when the judge was skipped (no key / http error / malformed). */
  skipped?: boolean;
  skipped_reason?: string;
}

export interface AgentExecutionContext {
  domain: string;
  country?: string;
  language?: string;
  targetTopic?: string;
  competitors?: string[];
  /** Q&A clarifications the user provided in prior turns / drivers. */
  priorClarifications?: Record<string, string>;
  /** Anthropic key for both the agent itself (if it calls Claude) and
   *  the quality judge. Both are skipped silently when missing. */
  anthropicKey?: string;
}

/**
 * Concrete agents implement this.
 *
 * `execute` runs the agent's methodology. When the quality loop decides
 * a retry is needed, it calls execute() again with a non-null `guidance`
 * — the agent must read it and adjust (e.g. relax confidence cutoff,
 * re-fetch from a different source, re-prompt the LLM with stricter
 * grounding rules).
 */
export interface Agent<TInput, TOutput> {
  /** Stable id — used as the row key in driver_results and in logs. */
  readonly name: string;
  /** Human-readable label for the UI. */
  readonly label: string;
  /** Plain-language description of WHAT this agent does and HOW. Surfaced
   *  in the "Dettagli" panel and supplied to the quality judge. */
  readonly methodology: string;

  execute(
    input: TInput,
    ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<TOutput>>;

  /** Build the compact summary the quality judge will read. Must be small
   *  (<8KB) — the judge gets methodology + summary, not raw payloads. */
  summarizeForQuality(result: AgentRunResult<TOutput>): string;
}

export interface QualityLoopHistoryEntry {
  attempt: number;
  verdict: QualityVerdict;
  /** ISO timestamp when this attempt completed. */
  at: string;
}

export interface AgentLoopOutcome<TOutput> {
  /** Best output produced — the final attempt, even if quality didn't pass. */
  result: AgentRunResult<TOutput>;
  /** Final quality verdict. */
  finalVerdict: QualityVerdict;
  /** Every quality verdict in order. */
  history: QualityLoopHistoryEntry[];
  /** Total attempts including the first. Always >=1. */
  attempts: number;
  /** True when the loop terminated on a passing verdict. */
  passed: boolean;
}

export interface AgentLoopOptions {
  /** Max retries AFTER the first attempt. Default 2 → up to 3 total runs. */
  maxRetries?: number;
  /** Quality score below which retry is forced even if verdict='pass'.
   *  Default 0 (off — trust the judge's verdict field). */
  retryBelowScore?: number;
  /** When true, surface every attempt's quality verdict to the logger. */
  verbose?: boolean;
}
