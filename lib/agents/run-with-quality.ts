// Generic agent loop runner: execute → quality judge → maybe retry.
//
// The single entry point used by both pilot agents (AI Relevance,
// MarTech). Caller passes any concrete Agent + input + context; runner
// returns the best output produced, the final verdict, and the full
// history of quality verdicts for auditability.

import { assessQuality } from './quality-agent';
import type {
  Agent,
  AgentExecutionContext,
  AgentLoopOptions,
  AgentLoopOutcome,
  AgentRunResult,
  QualityLoopHistoryEntry,
  QualityVerdict,
} from './types';

export async function runAgentWithQuality<TInput, TOutput>(
  agent: Agent<TInput, TOutput>,
  input: TInput,
  ctx: AgentExecutionContext,
  options: AgentLoopOptions = {},
): Promise<AgentLoopOutcome<TOutput>> {
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const maxAttempts = maxRetries + 1;
  const verbose = options.verbose ?? false;

  const history: QualityLoopHistoryEntry[] = [];
  let lastResult: AgentRunResult<TOutput> | null = null;
  let lastVerdict: QualityVerdict | null = null;
  let guidance: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (verbose) {
      console.log(`[agent:${agent.name}] attempt ${attempt}/${maxAttempts}${guidance ? ` with guidance` : ''}`);
    }
    let result: AgentRunResult<TOutput>;
    try {
      result = await agent.execute(input, ctx, guidance);
    } catch (err) {
      // An agent that throws is treated as a hard fail for THIS attempt.
      // We synthesize a fail verdict and stop the loop.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[agent:${agent.name}] execute threw on attempt ${attempt}:`, message);
      const failVerdict: QualityVerdict = {
        verdict: 'fail',
        score: 0,
        issues: [`Agent execution threw: ${message.slice(0, 300)}`],
        guidance: '',
      };
      history.push({ attempt, verdict: failVerdict, at: new Date().toISOString() });
      if (lastResult) {
        // Return the last successful result if we have one.
        return {
          result: lastResult,
          finalVerdict: failVerdict,
          history,
          attempts: attempt,
          passed: false,
        };
      }
      // No prior result — bubble up so the caller can decide.
      throw err;
    }
    lastResult = result;

    const verdict = await assessQuality({
      agentName: agent.name,
      agentLabel: agent.label,
      methodology: agent.methodology,
      outputSummary: agent.summarizeForQuality(result),
      evidence: result.evidence,
      context: {
        domain: ctx.domain,
        country: ctx.country,
        language: ctx.language,
        targetTopic: ctx.targetTopic,
      },
      priorVerdicts: history.map(h => h.verdict),
      attempt,
      maxAttempts,
      anthropicKey: ctx.anthropicKey,
    });
    lastVerdict = verdict;
    history.push({ attempt, verdict, at: new Date().toISOString() });

    if (verbose) {
      console.log(`[agent:${agent.name}] attempt ${attempt} verdict=${verdict.verdict} score=${verdict.score}`);
    }

    // Pass also triggers when score is high enough even if retryBelowScore wasn't met.
    const belowThreshold = options.retryBelowScore && verdict.score < options.retryBelowScore;
    if (verdict.verdict === 'pass' && !belowThreshold) {
      return { result, finalVerdict: verdict, history, attempts: attempt, passed: true };
    }
    if (verdict.verdict === 'fail') {
      return { result, finalVerdict: verdict, history, attempts: attempt, passed: false };
    }
    // verdict === 'retry' OR pass-with-below-threshold: prepare guidance for next attempt.
    if (attempt >= maxAttempts) {
      // Out of budget — return best-effort.
      return { result, finalVerdict: verdict, history, attempts: attempt, passed: false };
    }
    guidance = verdict.guidance || guidance;
  }

  // Loop exit is unreachable in practice — guard for TS.
  return {
    result: lastResult!,
    finalVerdict: lastVerdict!,
    history,
    attempts: maxAttempts,
    passed: lastVerdict?.verdict === 'pass',
  };
}
