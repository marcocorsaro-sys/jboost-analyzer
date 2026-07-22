// "Excellence" layer — second-pass LLM analysis that turns a driver's
// deterministic score + raw signals into a detailed, evidence-grounded
// narrative the user can actually use. Pilot agents (AI Relevance,
// Authority) call this after their primary execute() to enrich the
// output with findings + recommendations the quality judge then sees.
//
// Output shape is stable across all drivers so the UI can render it
// uniformly. New drivers opt in by calling produceExcellence() inside
// their execute() and merging the result into their output.

const ANTHROPIC_MODEL = 'claude-sonnet-5';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1500;

export interface ExcellenceFinding {
  /** Short headline (5-10 words). */
  title: string;
  /** 2-4 sentence paragraph with concrete data citations. */
  detail: string;
  /** 'positive' | 'concern' | 'neutral' — drives icon/color in UI. */
  signal: 'positive' | 'concern' | 'neutral';
  /** Concrete metrics/values cited (e.g. "DR=68", "AI Overview on 12/50 kw"). */
  evidence: string[];
}

export interface ExcellenceRecommendation {
  /** Short imperative title (e.g. "Recover 14 broken backlinks su /collection/*"). */
  title: string;
  /** 1-3 sentence concrete next step the user can actually take this week. */
  detail: string;
  /** 'high' | 'medium' | 'low'. */
  priority: 'high' | 'medium' | 'low';
  /** Effort estimate human-readable (e.g. "1-2 ore", "1 settimana", "trimestre"). */
  effort: string;
}

export interface ExcellenceOutput {
  /** One-paragraph executive summary tying the findings together. */
  executive_summary: string;
  findings: ExcellenceFinding[];
  recommendations: ExcellenceRecommendation[];
  /** Concrete data points the analysis is missing — surfaced as Q&A questions. */
  clarification_questions: Array<{ id: string; text: string; options?: string[] }>;
  /** Model used + token usage; surfaced for transparency/cost tracking. */
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
  /** Set when the LLM call was skipped (no key / http error / malformed). */
  skipped?: boolean;
  skipped_reason?: string;
}

export interface ExcellenceInput {
  /** Stable id like 'ai_relevance'. */
  driverName: string;
  driverLabel: string;
  /** The agent's declared methodology. */
  methodology: string;
  /** Compact dump of the deterministic output + raw signals. */
  factSheet: string;
  /** Context — domain, market, sector, competitors. */
  context: {
    domain: string;
    country?: string;
    language?: string;
    targetTopic?: string;
    competitors?: string[];
    priorClarifications?: Record<string, string>;
  };
  /** Anthropic key. Required — without it the call is skipped silently. */
  anthropicKey?: string;
}

const SYSTEM_PROMPT = `You are a senior SEO/GEO analyst delivering a SHORT but DEEP analysis of ONE driver for a B2B client. Your audience is a marketing lead who wants concrete, actionable insight — NOT generic SEO platitudes.

You receive:
- the driver's methodology (so you know what the score means),
- a fact sheet with score, status, and raw signals,
- the domain context (country, sector, competitors).

You produce:
- one-paragraph executive_summary tying the score to a business consequence,
- 3-5 findings, each with concrete evidence (numeric citations from the fact sheet),
- 2-4 prioritized recommendations the user can act on THIS WEEK or THIS MONTH,
- 0-2 clarification_questions if context is missing that would meaningfully change your interpretation.

Output ONLY valid JSON, no prose, no markdown fences. Schema:
{
  "executive_summary": string,
  "findings": [
    { "title": string, "detail": string, "signal": "positive"|"concern"|"neutral", "evidence": string[] }
  ],
  "recommendations": [
    { "title": string, "detail": string, "priority": "high"|"medium"|"low", "effort": string }
  ],
  "clarification_questions": [
    { "id": string, "text": string, "options"?: string[] }
  ]
}

RULES — followed STRICTLY:
- Every finding MUST quote at least one concrete number from the fact sheet in "evidence". Never invent metrics.
- Recommendations MUST be concrete enough that the user could brief an agency or developer without follow-up. E.g. "Audit and fix the 14 broken backlinks on /collection/* pages identified by Ahrefs". NOT "Improve link profile".
- "effort" must be a human estimate: "1-2 ore", "mezza giornata", "1 settimana", "trimestre".
- "signal" semantics: 'positive' = strength to defend; 'concern' = weakness to fix; 'neutral' = factual context.
- Maximum 5 findings, 4 recommendations, 2 questions. Less is fine.
- Stay strictly in this driver's domain — don't comment on other drivers.
- The executive_summary must reference the actual score and tie it to business consequences (lost traffic, lost trust, missed visibility, ...).
- Italian language for narrative (executive_summary, finding.detail, recommendation.detail). Keep field names/ids in English/snake_case.
- If the fact sheet shows the driver was 'no_results' or 'failed', produce a single finding explaining what's missing + a recommendation to remediate the data source.`;

function clamp<T>(arr: T[] | undefined, max: number): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max);
}

function parseExcellence(raw: string): Omit<ExcellenceOutput, 'model' | 'usage'> | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const sigOk = ['positive', 'concern', 'neutral'];
    const prOk = ['high', 'medium', 'low'];
    const executive_summary = typeof parsed.executive_summary === 'string'
      ? parsed.executive_summary.slice(0, 1200)
      : '';
    const findings: ExcellenceFinding[] = clamp(parsed.findings as ExcellenceFinding[] | undefined, 5)
      .filter(f => f && typeof f === 'object' && typeof f.title === 'string' && typeof f.detail === 'string')
      .map(f => ({
        title: String(f.title).slice(0, 200),
        detail: String(f.detail).slice(0, 800),
        signal: sigOk.includes(f.signal as string) ? f.signal : 'neutral',
        evidence: clamp(f.evidence as string[] | undefined, 6).filter(e => typeof e === 'string').map(e => String(e).slice(0, 300)),
      }));
    const recommendations: ExcellenceRecommendation[] = clamp(parsed.recommendations as ExcellenceRecommendation[] | undefined, 4)
      .filter(r => r && typeof r === 'object' && typeof r.title === 'string' && typeof r.detail === 'string')
      .map(r => ({
        title: String(r.title).slice(0, 200),
        detail: String(r.detail).slice(0, 800),
        priority: prOk.includes(r.priority as string) ? r.priority : 'medium',
        effort: typeof r.effort === 'string' ? String(r.effort).slice(0, 100) : '—',
      }));
    const clarification_questions = clamp(parsed.clarification_questions as Array<{ id: string; text: string; options?: string[] }> | undefined, 2)
      .filter(q => q && typeof q === 'object' && typeof q.id === 'string' && typeof q.text === 'string')
      .map(q => ({
        id: String(q.id).slice(0, 64).replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'question',
        text: String(q.text).slice(0, 400),
        options: Array.isArray(q.options)
          ? q.options.filter((o: unknown) => typeof o === 'string').slice(0, 4)
          : undefined,
      }));
    return { executive_summary, findings, recommendations, clarification_questions };
  } catch {
    return null;
  }
}

function skipped(reason: string): ExcellenceOutput {
  return {
    executive_summary: '',
    findings: [],
    recommendations: [],
    clarification_questions: [],
    skipped: true,
    skipped_reason: reason,
  };
}

function buildUserPrompt(input: ExcellenceInput): string {
  const c = input.context;
  const lines: string[] = [];
  lines.push(`Driver: ${input.driverName} (${input.driverLabel})`);
  lines.push(`Domain: ${c.domain}`);
  if (c.country) lines.push(`Country: ${c.country}`);
  if (c.language) lines.push(`Language: ${c.language}`);
  if (c.targetTopic) lines.push(`Target topic: ${c.targetTopic}`);
  if (c.competitors && c.competitors.length > 0) {
    lines.push(`Competitors: ${c.competitors.join(', ')}`);
  }
  if (c.priorClarifications && Object.keys(c.priorClarifications).length > 0) {
    lines.push('Prior clarifications from the user:');
    for (const [k, v] of Object.entries(c.priorClarifications)) {
      lines.push(`  - ${k}: ${v}`);
    }
  }
  lines.push('');
  lines.push('Methodology (as declared by the agent):');
  lines.push(input.methodology);
  lines.push('');
  lines.push('Fact sheet (deterministic output + raw signals):');
  lines.push(input.factSheet);
  lines.push('');
  lines.push('Produce your JSON now.');
  return lines.join('\n');
}

export async function produceExcellence(input: ExcellenceInput): Promise<ExcellenceOutput> {
  if (!input.anthropicKey) return skipped('no_anthropic_key');

  const userPrompt = buildUserPrompt(input);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
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
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[excellence:${input.driverName}] Anthropic ${res.status}: ${text.slice(0, 200)}`);
      return skipped(`anthropic_http_${res.status}`);
    }
    const data = await res.json();
    const content = data?.content?.[0]?.text;
    if (typeof content !== 'string') return skipped('anthropic_empty_response');
    const parsed = parseExcellence(content);
    if (!parsed) return skipped('malformed_json');
    return {
      ...parsed,
      model: ANTHROPIC_MODEL,
      usage: data?.usage
        ? { input_tokens: Number(data.usage.input_tokens) || 0, output_tokens: Number(data.usage.output_tokens) || 0 }
        : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[excellence:${input.driverName}] request failed:`, message);
    return skipped('request_failed');
  } finally {
    clearTimeout(timer);
  }
}
