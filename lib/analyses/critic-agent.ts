// Critic agent — LLM-based validator that inspects the output of each phase
// in the analysis pipeline and decides whether the orchestrator should pause
// to ask the user for clarifications.
//
// Design notes:
//  - The critic is "agentic": no hardcoded anomaly rules. The LLM reads the
//    raw output for the phase and returns its own verdict. This is more
//    flexible than rule-based validation but less predictable; the prompt
//    constrains output shape (strict JSON) and quantity (≤3 anomalies,
//    ≤2 questions per phase) to keep the UX manageable.
//  - The critic NEVER blocks the pipeline on its own failure: if Claude is
//    unreachable or returns malformed JSON, the function returns a "pass"
//    verdict so the analysis can complete unattended.
//  - Severity 'critical' is what forces a pause when the user has NOT opted
//    into step-by-step review. 'warning' and 'info' are surfaced in the UI
//    only if the analysis is already paused for another reason.

export type CriticSeverity = 'info' | 'warning' | 'critical';

export interface CriticAnomaly {
  severity: CriticSeverity;
  message: string;
  evidence: string;
}

export interface CriticQuestion {
  id: string;
  text: string;
  options?: string[];
}

export interface CriticVerdict {
  ok: boolean;
  anomalies: CriticAnomaly[];
  questions: CriticQuestion[];
  model?: string;
  skipped?: boolean;
  skipped_reason?: string;
}

export interface CriticContext {
  domain: string;
  country: string;
  language: string;
  targetTopic?: string;
  competitors?: string[];
  /** Answers from prior critic questions on previous phases. */
  priorClarifications?: Record<string, string>;
}

export interface CriticInput {
  phase: string;
  /** A compact summary of what the phase just produced. Should be small
   *  enough to fit comfortably in the prompt — typically a few KB. */
  output: Record<string, unknown>;
  context: CriticContext;
  /** API key. If null/empty, the critic is skipped (pass verdict). */
  anthropicKey?: string;
}

const SYSTEM_PROMPT = `You are a critic agent for an SEO/GEO analysis pipeline. Your job is to inspect the output of one phase of the pipeline and flag:
1. ANOMALIES — inconsistencies, suspicious values, missing data, unrealistic numbers, or contradictions between data sources.
2. QUESTIONS — context the analyst should provide that would significantly improve later phases (target audience, geographic focus, recent business changes, content strategy, etc.).

Be strict but not noisy. Stay silent on routine variation.

Output ONLY valid JSON. No prose, no markdown fences. Schema:
{
  "ok": boolean,
  "anomalies": [
    {"severity": "info"|"warning"|"critical", "message": string, "evidence": string}
  ],
  "questions": [
    {"id": string, "text": string, "options": (string[])?}
  ]
}

Rules:
- "ok" MUST be false when at least one anomaly has severity "critical". Otherwise true.
- Maximum 3 anomalies. Maximum 2 questions.
- "id" for questions: snake_case, descriptive (e.g. "is_recent_redesign", "target_audience_b2b_b2c"). Unique within this verdict.
- Use severity "critical" ONLY for issues that, if ignored, would lead to misleading recommendations (e.g. domain rating crashed unexpectedly, AI relevance contradicts content volume).
- "evidence" must quote concrete values from the input, not generic explanations.
- Questions must be answerable in 1-2 sentences OR via the "options" list (max 4 options).
- Skip both lists silently when the output looks healthy and no context is needed.`;

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const REQUEST_TIMEOUT_MS = 20_000;

function clamp<T>(arr: T[] | undefined, max: number): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max);
}

function passVerdict(reason: string): CriticVerdict {
  return { ok: true, anomalies: [], questions: [], skipped: true, skipped_reason: reason };
}

function buildUserPrompt(input: CriticInput): string {
  const { phase, output, context } = input;
  const lines: string[] = [];
  lines.push(`Phase: ${phase}`);
  lines.push(`Domain: ${context.domain}`);
  lines.push(`Country: ${context.country} | Language: ${context.language}`);
  if (context.targetTopic) lines.push(`Target topic: ${context.targetTopic}`);
  if (context.competitors && context.competitors.length > 0) {
    lines.push(`Competitors: ${context.competitors.join(', ')}`);
  }
  if (context.priorClarifications && Object.keys(context.priorClarifications).length > 0) {
    lines.push(`Prior clarifications from the user:`);
    for (const [k, v] of Object.entries(context.priorClarifications)) {
      lines.push(`  - ${k}: ${v}`);
    }
  }
  lines.push('');
  lines.push('Phase output (JSON):');
  lines.push('```json');
  lines.push(JSON.stringify(output, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('Return your verdict as JSON now.');
  return lines.join('\n');
}

function parseVerdict(raw: string): CriticVerdict | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const ok = typeof parsed.ok === 'boolean' ? parsed.ok : true;
    const anomalies: CriticAnomaly[] = clamp(parsed.anomalies as CriticAnomaly[] | undefined, 3)
      .filter(a => a && typeof a === 'object' && typeof a.message === 'string')
      .map(a => ({
        severity: (['info', 'warning', 'critical'] as const).includes(a.severity as CriticSeverity)
          ? a.severity as CriticSeverity
          : 'info',
        message: String(a.message),
        evidence: typeof a.evidence === 'string' ? a.evidence : '',
      }));
    const questions: CriticQuestion[] = clamp(parsed.questions as CriticQuestion[] | undefined, 2)
      .filter(q => q && typeof q === 'object' && typeof q.id === 'string' && typeof q.text === 'string')
      .map(q => ({
        id: String(q.id).slice(0, 64).replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'question',
        text: String(q.text),
        options: Array.isArray(q.options)
          ? q.options.filter((o: unknown) => typeof o === 'string').slice(0, 4)
          : undefined,
      }));
    // Enforce the rule "ok must be false when any critical anomaly exists".
    const hasCritical = anomalies.some(a => a.severity === 'critical');
    return {
      ok: hasCritical ? false : ok,
      anomalies,
      questions,
    };
  } catch {
    return null;
  }
}

export async function criticAgent(input: CriticInput): Promise<CriticVerdict> {
  if (!input.anthropicKey) {
    return passVerdict('no_anthropic_key');
  }

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
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[critic] Anthropic ${res.status}: ${text.slice(0, 200)}`);
      return passVerdict(`anthropic_http_${res.status}`);
    }

    const data = await res.json();
    const content = data?.content?.[0]?.text;
    if (typeof content !== 'string') {
      return passVerdict('anthropic_empty_response');
    }
    const verdict = parseVerdict(content);
    if (!verdict) {
      console.warn('[critic] malformed JSON, raw response:', content.slice(0, 300));
      return passVerdict('malformed_json');
    }
    return { ...verdict, model: ANTHROPIC_MODEL };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[critic] request failed:', message);
    return passVerdict('request_failed');
  } finally {
    clearTimeout(timer);
  }
}

/** True if the verdict should force a pause (regardless of user's pause toggle). */
export function shouldForcePause(verdict: CriticVerdict): boolean {
  return !verdict.ok || verdict.questions.length > 0;
}
