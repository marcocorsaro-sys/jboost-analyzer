// Driver Interpreter Agent — one per driver. Takes the deterministic
// score + raw signals and decides if the user can provide context that
// would meaningfully refine the driver's interpretation.
//
// Non-blocking by design: the verdict is persisted on driver_results
// and surfaced in the UI, but the pipeline never pauses on its own
// because of a driver agent. This keeps the analysis fast and lets
// the user opt into dialogue only on the drivers they care about.

export interface DriverQuestion {
  id: string;
  text: string;
  options?: string[];
}

/** A single user-or-agent turn in the per-driver Q&A thread. */
export interface DriverTurn {
  role: 'user' | 'agent';
  /** For agent turns: the JSON-encoded verdict at that turn. For user
   *  turns: the answers map serialized as compact key=value lines. */
  content: string;
  turn_idx: number;
  timestamp: string;
}

/** Maximum number of agent turns in a single driver conversation. After
 *  this, the agent locks the verdict and stops asking new questions. */
export const MAX_AGENT_TURNS = 3;

export interface DriverVerdict {
  observations: string[];
  questions: DriverQuestion[];
  needs_dialogue: boolean;
  /** Conversation history. Always starts with the agent's turn 0. */
  turns?: DriverTurn[];
  /** Number of agent turns so far (0..MAX_AGENT_TURNS). */
  turn_count?: number;
  /** True once the agent has used its budget — UI hides input. */
  locked?: boolean;
  model?: string;
  skipped?: boolean;
  skipped_reason?: string;
  answered_at?: string;
}

export interface DriverContext {
  domain: string;
  country: string;
  language: string;
  targetTopic?: string;
  competitors?: string[];
  priorClarifications?: Record<string, string>;
}

export interface DriverInput {
  driverName: string;
  driverLabel: string;
  driverDescription: string;
  score: number | null;
  status: 'ok' | 'no_results' | 'failed' | string;
  issues: unknown[];
  rawData: Record<string, unknown>;
  context: DriverContext;
  anthropicKey?: string;
  /** Prior turns in this driver's conversation. The agent uses them to
   *  decide whether to ask follow-ups or to close the dialogue. */
  priorTurns?: DriverTurn[];
}

const SYSTEM_PROMPT = `You are a domain-specialist agent for ONE driver of a SEO/GEO analysis. Your job: given the deterministic score and raw signals for this driver, decide whether the user can provide context that would meaningfully refine your interpretation.

You operate in a multi-turn Q&A loop. The conversation has a HARD CAP of 3 agent turns. After turn 3, do NOT ask new questions — only synthesize a final interpretation in "observations".

Output ONLY valid JSON. No prose, no markdown fences. Schema:
{
  "observations": string[],
  "questions": [{"id": string, "text": string, "options": (string[])?}],
  "needs_dialogue": boolean
}

Rules:
- "observations": 1-3 short notes about what the data says about THIS driver specifically. Reference concrete numbers from the input. Stay in your driver's domain (don't comment on other drivers).
  * On turn >= 2, incorporate the user's prior answers into your observations.
  * On turn 3 (final), produce a synthesis that supersedes the earlier observations.
- "questions": 0-2 questions whose answer would change your interpretation. Each must be answerable in 1-2 sentences or via the "options" list (max 4 options). "id" snake_case, unique within this verdict.
  * On turn 3, ALWAYS return questions=[].
  * On any turn, return [] if the score is healthy and the data is unambiguous.
- "needs_dialogue": true only when questions.length > 0 AND the answer would meaningfully change the interpretation.
- Never invent data. If a signal is missing or null, just acknowledge that.
- Never repeat a question the user has already answered in the conversation history.`;

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const REQUEST_TIMEOUT_MS = 15_000;

function clamp<T>(arr: T[] | undefined, max: number): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max);
}

function passVerdict(reason: string): DriverVerdict {
  return { observations: [], questions: [], needs_dialogue: false, skipped: true, skipped_reason: reason };
}

function buildUserPrompt(input: DriverInput, nextTurnIdx: number): string {
  const { driverName, driverLabel, driverDescription, score, status, issues, rawData, context, priorTurns } = input;
  const lines: string[] = [];
  lines.push(`Driver: ${driverName} (${driverLabel})`);
  lines.push(`Description: ${driverDescription}`);
  lines.push(`Domain: ${context.domain} | Country: ${context.country} | Language: ${context.language}`);
  if (context.targetTopic) lines.push(`Target topic: ${context.targetTopic}`);
  if (context.competitors && context.competitors.length > 0) {
    lines.push(`Competitors: ${context.competitors.join(', ')}`);
  }
  if (context.priorClarifications && Object.keys(context.priorClarifications).length > 0) {
    lines.push('Prior clarifications from the user (global, across all drivers):');
    for (const [k, v] of Object.entries(context.priorClarifications)) {
      lines.push(`  - ${k}: ${v}`);
    }
  }
  lines.push('');
  lines.push(`Score: ${score === null ? 'null (no_results)' : score} / 100`);
  lines.push(`Status: ${status}`);
  lines.push('');
  lines.push('Issues detected (deterministic rules):');
  lines.push('```json');
  lines.push(JSON.stringify(issues, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('Raw signals used to compute the score:');
  lines.push('```json');
  lines.push(JSON.stringify(rawData, null, 2));
  lines.push('```');
  if (priorTurns && priorTurns.length > 0) {
    lines.push('');
    lines.push('Conversation so far in THIS driver (chronological):');
    for (const t of priorTurns) {
      const tag = t.role === 'agent' ? '[agent]' : '[user]';
      lines.push(`${tag} turn ${t.turn_idx}: ${t.content}`);
    }
  }
  lines.push('');
  lines.push(`This is your AGENT TURN ${nextTurnIdx} of ${MAX_AGENT_TURNS}.`);
  if (nextTurnIdx >= MAX_AGENT_TURNS) {
    lines.push('This is the FINAL turn: return your synthesized observations and questions=[].');
  }
  lines.push('Return your verdict as JSON now.');
  return lines.join('\n');
}

function parseVerdict(raw: string): DriverVerdict | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const observations: string[] = clamp(parsed.observations as string[] | undefined, 3)
      .filter((o): o is string => typeof o === 'string')
      .map(o => o.slice(0, 500));
    const questions: DriverQuestion[] = clamp(parsed.questions as DriverQuestion[] | undefined, 2)
      .filter(q => q && typeof q === 'object' && typeof q.id === 'string' && typeof q.text === 'string')
      .map(q => ({
        id: String(q.id).slice(0, 64).replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'question',
        text: String(q.text),
        options: Array.isArray(q.options)
          ? q.options.filter((o: unknown) => typeof o === 'string').slice(0, 4)
          : undefined,
      }));
    const needs_dialogue = typeof parsed.needs_dialogue === 'boolean'
      ? parsed.needs_dialogue
      : questions.length > 0;
    return { observations, questions, needs_dialogue };
  } catch {
    return null;
  }
}

export async function driverAgent(input: DriverInput): Promise<DriverVerdict> {
  if (!input.anthropicKey) {
    return passVerdict('no_anthropic_key');
  }

  const priorAgentTurns = (input.priorTurns ?? []).filter(t => t.role === 'agent').length;
  const nextTurnIdx = priorAgentTurns + 1;

  const userPrompt = buildUserPrompt(input, nextTurnIdx);
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
      console.warn(`[driver-agent:${input.driverName}] Anthropic ${res.status}: ${text.slice(0, 200)}`);
      return passVerdict(`anthropic_http_${res.status}`);
    }
    const data = await res.json();
    const content = data?.content?.[0]?.text;
    if (typeof content !== 'string') {
      return passVerdict('anthropic_empty_response');
    }
    const verdict = parseVerdict(content);
    if (!verdict) {
      console.warn(`[driver-agent:${input.driverName}] malformed JSON, raw:`, content.slice(0, 300));
      return passVerdict('malformed_json');
    }
    // Enforce the turn cap server-side: on the final turn, drop any
    // questions the model may have included by mistake.
    if (nextTurnIdx >= MAX_AGENT_TURNS) {
      verdict.questions = [];
      verdict.needs_dialogue = false;
    }
    return {
      ...verdict,
      model: ANTHROPIC_MODEL,
      turn_count: nextTurnIdx,
      locked: nextTurnIdx >= MAX_AGENT_TURNS || verdict.questions.length === 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[driver-agent:${input.driverName}] request failed:`, message);
    return passVerdict('request_failed');
  } finally {
    clearTimeout(timer);
  }
}
