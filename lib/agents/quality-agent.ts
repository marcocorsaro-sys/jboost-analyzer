// Quality judge — generic Anthropic-backed agent that scores the
// output of any concrete Agent and decides whether to ship, retry
// with guidance, or fail the attempt.
//
// Symmetric to lib/analyses/critic-agent.ts (which judges whole
// pipeline phases). Difference: this one is PER AGENT, smaller-scoped,
// and drives a synchronous retry loop. The two coexist for now —
// critic stays around for the phase-level pause/resume flow.

import type { QualityVerdict, QualityVerdictKind } from './types';

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_TOKENS = 600;

export interface QualityJudgeInput {
  /** Stable id of the agent being judged (e.g. 'ai_relevance'). */
  agentName: string;
  /** Human label for the prompt. */
  agentLabel: string;
  /** The agent's methodology paragraph. */
  methodology: string;
  /** Compact summary of the agent's output, as built by the agent's
   *  summarizeForQuality(). Kept small; the judge does NOT see raw API
   *  payloads. */
  outputSummary: string;
  /** Evidence the agent cited (script srcs, scores, etc). */
  evidence: string[];
  /** Domain + locale context. */
  context: {
    domain: string;
    country?: string;
    language?: string;
    targetTopic?: string;
  };
  /** Verdicts from prior attempts in the same loop, oldest first. */
  priorVerdicts?: QualityVerdict[];
  /** Attempt index (1-based). */
  attempt: number;
  /** Max attempts in the loop — passed to the judge so it knows when
   *  it's giving the FINAL verdict (no more retries possible). */
  maxAttempts: number;
  anthropicKey?: string;
}

const SYSTEM_PROMPT = `You are a strict quality judge for a single agent in a multi-agent SEO/GEO analysis platform. Your only job is to decide whether the agent's output is good enough to ship to the user, or needs another attempt with explicit guidance.

You are SHOWN: the agent's name, its declared methodology, a compact summary of its output, and the concrete evidence it claims. You are NOT shown raw API payloads — judge from the summary and methodology alone.

Output ONLY valid JSON. No prose, no markdown fences. Schema:
{
  "verdict": "pass" | "retry" | "fail",
  "score": <0-100>,
  "issues": string[],
  "guidance": string
}

VERDICT semantics:
- "pass": the output is consistent with the declared methodology, evidence is concrete and sufficient, no logical contradictions. Ship it.
- "retry": the output is salvageable but has fixable issues. Provide non-trivial, actionable "guidance" the agent will read on the next attempt. NEVER return retry with empty/vague guidance.
- "fail": the agent's methodology cannot produce a trustworthy answer for this domain/input (e.g. data sources unavailable, no signal at all). No retry will help.

SCORE: your independent 0-100 quality rating. score >= 80 typically means pass; 50-79 typically means retry; <50 typically means fail. The verdict field is authoritative — use score as transparency.

ISSUES: bullet list of concrete problems. Quote specific values from the summary. Empty array on pass.

GUIDANCE: what the agent should do differently on retry. Be concrete: "lower confidence threshold from 0.7 to 0.5 and re-include the GTM signal", "re-scrape an additional page (/about) to pick up backend signals", "re-interpret the same data with the user's stated B2B focus in mind". Empty string when verdict != "retry".

RULES:
- If this is the final attempt (you'll be told), NEVER return "retry" — choose pass or fail.
- Stay focused on the SINGLE agent in front of you. Do not comment on other drivers.
- Reward concrete, evidence-grounded outputs. Penalize hand-wavy or contradictory ones.
- Be strict on grounding: an agent claiming a tool/score without naming evidence should fail or retry.`;

function clampStringArr(arr: unknown, maxItems: number, maxLen = 400): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s): s is string => typeof s === 'string')
    .slice(0, maxItems)
    .map(s => s.slice(0, maxLen));
}

function passVerdict(reason: string): QualityVerdict {
  return {
    verdict: 'pass',
    score: 0,
    issues: [],
    guidance: '',
    skipped: true,
    skipped_reason: reason,
  };
}

function parseVerdict(raw: string, isFinalAttempt: boolean): QualityVerdict | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const validKinds: QualityVerdictKind[] = ['pass', 'retry', 'fail'];
    let verdict: QualityVerdictKind = validKinds.includes(parsed.verdict)
      ? parsed.verdict
      : 'pass';

    // Hard server-side rule: never allow retry on the final attempt.
    if (isFinalAttempt && verdict === 'retry') {
      const numericScore = typeof parsed.score === 'number' ? parsed.score : 50;
      verdict = numericScore >= 60 ? 'pass' : 'fail';
    }

    const score = typeof parsed.score === 'number'
      ? Math.max(0, Math.min(100, Math.round(parsed.score)))
      : 50;
    const issues = clampStringArr(parsed.issues, 6, 300);
    const guidance = typeof parsed.guidance === 'string'
      ? parsed.guidance.slice(0, 1200)
      : '';

    return { verdict, score, issues, guidance };
  } catch {
    return null;
  }
}

function buildUserPrompt(input: QualityJudgeInput): string {
  const lines: string[] = [];
  lines.push(`Agent: ${input.agentName} (${input.agentLabel})`);
  lines.push(`Domain: ${input.context.domain}`);
  if (input.context.country) lines.push(`Country: ${input.context.country}`);
  if (input.context.language) lines.push(`Language: ${input.context.language}`);
  if (input.context.targetTopic) lines.push(`Target topic: ${input.context.targetTopic}`);
  lines.push('');
  lines.push('Methodology (as declared by the agent):');
  lines.push(input.methodology);
  lines.push('');
  lines.push('Output summary:');
  lines.push(input.outputSummary);
  lines.push('');
  if (input.evidence.length > 0) {
    lines.push('Evidence cited by the agent:');
    for (const e of input.evidence.slice(0, 20)) {
      lines.push(`  - ${e}`);
    }
    lines.push('');
  }
  if (input.priorVerdicts && input.priorVerdicts.length > 0) {
    lines.push('Your prior verdicts on earlier attempts of this loop:');
    input.priorVerdicts.forEach((v, i) => {
      lines.push(`  Attempt ${i + 1}: verdict=${v.verdict}, score=${v.score}`);
      if (v.guidance) lines.push(`    guidance was: ${v.guidance.slice(0, 200)}`);
    });
    lines.push('');
  }
  const isFinal = input.attempt >= input.maxAttempts;
  lines.push(`This is attempt ${input.attempt} of ${input.maxAttempts}.${isFinal ? ' FINAL — no more retries are possible, choose pass or fail only.' : ''}`);
  lines.push('Return your JSON verdict now.');
  return lines.join('\n');
}

export async function assessQuality(input: QualityJudgeInput): Promise<QualityVerdict> {
  if (!input.anthropicKey) {
    return passVerdict('no_anthropic_key');
  }

  const isFinal = input.attempt >= input.maxAttempts;
  const userPrompt = buildUserPrompt(input);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[quality:${input.agentName}] Anthropic ${res.status}: ${text.slice(0, 200)}`);
      return passVerdict(`anthropic_http_${res.status}`);
    }

    const data = await res.json();
    const content = data?.content?.[0]?.text;
    if (typeof content !== 'string') {
      return passVerdict('anthropic_empty_response');
    }
    const verdict = parseVerdict(content, isFinal);
    if (!verdict) {
      console.warn(`[quality:${input.agentName}] malformed JSON, raw:`, content.slice(0, 300));
      return passVerdict('malformed_json');
    }
    return { ...verdict, model: ANTHROPIC_MODEL };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[quality:${input.agentName}] request failed:`, message);
    return passVerdict('request_failed');
  } finally {
    clearTimeout(timer);
  }
}
