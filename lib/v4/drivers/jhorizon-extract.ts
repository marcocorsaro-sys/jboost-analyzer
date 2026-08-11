/**
 * V4 — J-Horizon paste-driven extraction (AI Visibility).
 *
 * J-Horizon has no API (Bibbia 8d): the app shows a ready-made prompt, the
 * operator pastes it into the J-Horizon chatbot and pastes the answer back.
 * ONE LLM call then extracts the GEO scores per site and writes both the
 * absolute and relative comments (Bibbia sheets 3 and 7, decision sheet 17).
 *
 * Why an LLM here at all, when the V4 rule is "no LLM near a number": the
 * pasted answer IS the source, and it is free text. The extraction is the
 * only way to read it — but it is validated like any other source payload:
 * a score outside 0-100 is an error (never clamped), an unknown site is
 * ignored, and a site the text does not cover stays null (J-Horizon covering
 * only part of the competitor set is expected, sheet 17 "AI Visibility
 * competitors"). The extracted scores remain operator-editable: the manual
 * {score, competitor_scores} path bypasses this module entirely.
 *
 * The call itself: thinking disabled on purpose — the 1500-token budget is
 * tight and an enabled thinking block would truncate the JSON (same choice
 * as the MarTech detector, lib/martech/detect.ts).
 */

import type { AnalysisSite } from '@/lib/v4/runner/types'
import { DriverSourceError } from './source'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const EXTRACTION_MODEL = 'claude-sonnet-5'

/** One extracted score. null = the pasted text does not cover this site. */
export interface ExtractedScore {
  site_ref: AnalysisSite['site_ref']
  geo_score: number | null
}

export interface JhorizonExtraction {
  scores: ExtractedScore[]
  comment_absolute: string
  comment_relative: string
}

/**
 * Pure: the prompt the operator copies into the J-Horizon chatbot.
 *
 * It asks for a GEO Score per site (client + every competitor, domains
 * spelled out) with a short motivation each — exactly the shape the
 * extraction step knows how to read back.
 */
export function buildJhorizonPrompt(sites: AnalysisSite[]): string {
  const lines = sites.map((s) => {
    const brand = s.brand_name?.trim() || s.name
    const role = s.is_client ? 'Cliente' : s.name
    return `- ${role}: ${brand} (${s.domain})`
  })
  return [
    'Calcola il GEO Score (0-100) di ciascuno dei seguenti brand, ovvero la visibilità',
    'del brand nelle risposte dei motori AI (ChatGPT, Perplexity, Gemini, ecc.):',
    ...lines,
    '',
    'Per OGNI sito riporta nella risposta:',
    '1. il dominio;',
    '2. il GEO Score da 0 a 100;',
    '3. una breve motivazione del punteggio (2-3 frasi).',
    'Se non hai dati su un sito, dichiaralo esplicitamente invece di stimare.',
  ].join('\n')
}

/** Pure: the extraction prompt sent to the model with the pasted answer. */
export function buildExtractionPrompt(pasted: string, sites: AnalysisSite[]): string {
  const roster = sites.map((s) => ({
    site_ref: s.site_ref,
    domain: s.domain,
    brand: s.brand_name?.trim() || s.name,
  }))
  return [
    'You are extracting GEO scores from a pasted J-Horizon chatbot answer.',
    'Sites to look for (match by domain or brand name):',
    JSON.stringify(roster),
    '',
    'Pasted answer:',
    '"""',
    pasted,
    '"""',
    '',
    'Return ONLY a JSON object, no prose, no code fences, with this exact shape:',
    '{"scores":[{"site_ref":string,"geo_score":number|null}],"comment_absolute":string,"comment_relative":string}',
    '',
    'Rules:',
    '- one scores entry per site in the roster, using its site_ref;',
    '- geo_score is the 0-100 GEO score the answer reports for that site;',
    '- geo_score MUST be null when the answer does not cover the site. NEVER invent or estimate a score;',
    '- comment_absolute: Italian, 300-600 characters, about the client score on the absolute 0-100 GEO scale, grounded in the motivations of the pasted answer;',
    '- comment_relative: Italian, 300-600 characters, about the client versus the competitors covered by the answer;',
    '- do not use em-dash characters in the comments.',
  ].join('\n')
}

/** Options for callers that need a different model/budget than the extraction. */
export interface AnthropicCallOptions {
  model?: string
  maxTokens?: number
  /**
   * Only sent when the model accepts it (see modelAcceptsTemperature): the
   * claude-sonnet-5 family rejects the parameter outright (commit #42),
   * while the Opus 4.x tier accepts it (the Executive Summary runs at 0.4,
   * Bibbia sheet 16 C).
   */
  temperature?: number
  system?: string
  timeoutMs?: number
}

export interface AnthropicCallResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
}

/**
 * claude-sonnet-5 (and its dated variants) rejects the temperature parameter;
 * older Sonnet generations and the Opus tier accept it. Centralized here so
 * every V4 call site respects the per-model difference the same way.
 */
export function modelAcceptsTemperature(model: string): boolean {
  return !model.startsWith('claude-sonnet-5')
}

/**
 * Minimal Anthropic Messages call, with token usage for cost tracking.
 * Throws DriverSourceError on any transport or API failure — the caller
 * treats it like any other blocked source. Shared by the J-Horizon
 * extraction and the sheet 15/16 insight orchestrator (lib/v4/llm).
 */
export async function callAnthropicWithUsage(
  prompt: string,
  what: string,
  options: AnthropicCallOptions = {},
): Promise<AnthropicCallResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    throw new DriverSourceError(`${what} — ANTHROPIC_API_KEY is not configured`)
  }

  const model = options.model ?? EXTRACTION_MODEL

  // Thinking disabled for every call: the token budgets are sized for the
  // JSON alone and an enabled thinking block would truncate it (same choice
  // as the MarTech detector). Temperature only where the model accepts it.
  const payload: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 1500,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: prompt }],
  }
  if (options.system) payload.system = options.system
  if (options.temperature !== undefined && modelAcceptsTemperature(model)) {
    payload.temperature = options.temperature
  }

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    })
  } catch (err) {
    throw new DriverSourceError(
      `${what} — Anthropic request failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!res.ok) {
    throw new DriverSourceError(`${what} — Anthropic answered ${res.status}`)
  }

  const body = (await res.json()) as {
    content?: Array<{ text?: unknown }>
    usage?: { input_tokens?: unknown; output_tokens?: unknown }
  }
  const text = (body.content ?? [])
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('')
  if (!text.trim()) {
    throw new DriverSourceError(`${what} — Anthropic returned no text`)
  }
  return {
    text,
    model,
    inputTokens: Number(body.usage?.input_tokens) || 0,
    outputTokens: Number(body.usage?.output_tokens) || 0,
  }
}

/** Original text-only signature, kept for the extraction call sites. */
export async function callAnthropic(prompt: string, what: string): Promise<string> {
  return (await callAnthropicWithUsage(prompt, what)).text
}

/**
 * Pure: validate the model's JSON against the site set.
 *
 * Same contract as parseAiVisibilityDecision: NO clamping — a score outside
 * 0-100 is an error, because silently correcting it would hide that the
 * extraction (or the pasted answer) is wrong. An unknown site_ref is ignored;
 * a missing site stays null (partial J-Horizon coverage is expected).
 */
export function parseExtraction(
  text: string,
  sites: AnalysisSite[],
): { extraction: JhorizonExtraction | null; error: string | null } {
  // Models occasionally wrap the JSON in fences despite instructions: take
  // the outermost object rather than failing on the wrapper.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return { extraction: null, error: 'estrazione J-Horizon: la risposta del modello non contiene JSON' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { extraction: null, error: 'estrazione J-Horizon: JSON non valido nella risposta del modello' }
  }

  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.scores)) {
    return { extraction: null, error: 'estrazione J-Horizon: manca l\'array "scores"' }
  }

  const known = new Map(sites.map((s) => [s.site_ref, s]))
  const byRef = new Map<AnalysisSite['site_ref'], number | null>()

  for (const entry of obj.scores as Array<Record<string, unknown>>) {
    const ref = String(entry?.site_ref ?? '') as AnalysisSite['site_ref']
    if (!known.has(ref)) continue // unknown site: ignored, never scored

    const raw = entry.geo_score
    if (raw === null || raw === undefined) {
      if (!byRef.has(ref)) byRef.set(ref, null)
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return {
        extraction: null,
        error: `estrazione J-Horizon: geo_score non valido per ${ref}: ${String(raw)} (atteso 0-100)`,
      }
    }
    byRef.set(ref, n)
  }

  return {
    extraction: {
      scores: sites.map((s) => ({ site_ref: s.site_ref, geo_score: byRef.get(s.site_ref) ?? null })),
      comment_absolute: typeof obj.comment_absolute === 'string' ? obj.comment_absolute : '',
      comment_relative: typeof obj.comment_relative === 'string' ? obj.comment_relative : '',
    },
    error: null,
  }
}

/**
 * The one LLM call of the driver: pasted answer in, validated scores +
 * both comments out. Throws DriverSourceError on API failure; returns a
 * parse error (not a throw) when the model's output fails validation, so
 * the worker can report it as the driver's own error.
 */
export async function extractGeoScores(
  pasted: string,
  sites: AnalysisSite[],
): Promise<{ extraction: JhorizonExtraction | null; error: string | null }> {
  const text = await callAnthropic(
    buildExtractionPrompt(pasted, sites),
    'AI Visibility (J-Horizon extraction)',
  )
  return parseExtraction(text, sites)
}
