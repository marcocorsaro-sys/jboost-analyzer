/**
 * Schema Radiography — LLM enrichment.
 *
 * Given a template (schema.org type detected on the site) plus the list of
 * missing properties from the rubric, asks Claude Sonnet to draft realistic
 * values for those properties using the page content as evidence. Returns a
 * ready-to-paste JSON-LD object the user can drop into their site.
 *
 * The model NEVER decides the "projected score" — that's recomputed
 * deterministically by lib/schema/score.ts from the proposed property set.
 */

import type { RubricProperty } from './rubrics'
import type { SchemaBlock } from './extract'

const SONNET_MODEL = 'claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS = 2048

export interface EnrichmentProperty {
  key: string
  tier: RubricProperty['tier']
  why: string
  /** LLM-drafted value (string, number, object, or array). Null if the model couldn't propose one. */
  draftValue: unknown
  /** Free-text rationale for the draft value, grounded in the page content. */
  rationale: string
}

export interface EnrichmentProposal {
  rubricType: string
  /** Missing properties enriched by the LLM, ordered by tier weight desc. */
  properties: EnrichmentProperty[]
  /** Complete JSON-LD block ready to copy-paste (current + drafts merged). */
  readyToPaste: Record<string, unknown>
  /** Token usage for cost tracking. */
  usage: { input_tokens: number; output_tokens: number }
  /** Set when enrichment failed — UI surfaces this as a diagnostic. */
  error?: string
}

export interface EnrichmentInput {
  domain: string
  pageRoleLabel: string
  rubricType: string
  /** A representative current JSON-LD block of this type from the site. */
  sampleBlock: SchemaBlock
  /** Properties missing on the sample (subset of the rubric). */
  missing: RubricProperty[]
  /** Trimmed page text to ground the drafts in the actual site content. */
  pageMarkdown: string | null
}

function buildSystemPrompt(rubricType: string): string {
  return `You are a structured-data SEO expert. The user gives you ONE schema.org type ("${rubricType}") detected on a real client website, the current JSON-LD they publish (which is INCOMPLETE), the list of properties they're missing, and a trimmed view of the page content.

Your job: draft a realistic, ready-to-publish VALUE for each missing property, grounded in the page content the user provides. Never invent facts that aren't supported by the page. If a property can't be drafted from the available evidence, return null for draftValue and explain why.

Output ONLY a valid JSON object (no prose, no markdown fences) matching:
{
  "properties": [
    {
      "key": "<property name>",
      "draftValue": <string | number | object | array | null>,
      "rationale": "<1-2 lines: where this value came from in the page>"
    }
  ],
  "readyToPaste": <a complete JSON-LD object for this @type combining the user's current properties with your drafts; schema.org-compliant; @context = "https://schema.org">
}

Rules:
- Every draftValue must be a real, plausible value for a production site (no placeholders like "TODO", "Example", "Lorem ipsum").
- Strings must be in the website's language (detect from the page content).
- Dates MUST be ISO 8601 (YYYY-MM-DD or full datetime).
- Durations MUST be ISO 8601 (PT15M, PT1H30M, ...).
- For \`address\`, return a PostalAddress sub-object with at least streetAddress + addressLocality + addressCountry when the page mentions them.
- For \`sameAs\`, return an array of URLs to the brand's social profiles found in the page (Facebook, Instagram, LinkedIn, YouTube, X/Twitter, Wikipedia).
- For \`offers\`/\`aggregateRating\`/\`review\`, draft only if numeric or structural evidence appears in the page; otherwise draftValue: null.
- The \`readyToPaste\` object must include the user's existing properties unchanged AND the drafted ones, with "@context": "https://schema.org" and "@type": "${rubricType}".`
}

function buildUserMessage(input: EnrichmentInput): string {
  const { domain, pageRoleLabel, sampleBlock, missing, pageMarkdown } = input
  const missingList = missing
    .map(p => `  - ${p.key} (${p.tier}): ${p.why}`)
    .join('\n')
  const current = JSON.stringify(sampleBlock.raw, null, 2)
  const md = (pageMarkdown ?? '').slice(0, 8_000)
  return [
    `# Domain: ${domain}`,
    `# Page role: ${pageRoleLabel}`,
    `# Page URL: ${sampleBlock.pageUrl}`,
    '',
    '## Current JSON-LD (incomplete)',
    '```json',
    current,
    '```',
    '',
    '## Missing properties to draft',
    missingList,
    '',
    '## Page content (markdown, trimmed)',
    '```markdown',
    md || '(no markdown available — use the JSON-LD context only)',
    '```',
    '',
    `Draft realistic values for the missing properties, grounded in the page above. Return ONLY the JSON object described in the system prompt.`,
  ].join('\n')
}

async function callSonnet(
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${errBody.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>
    usage?: { input_tokens: number; output_tokens: number }
  }

  const textBlock = data.content.find(b => b.type === 'text')
  if (!textBlock?.text) throw new Error('Anthropic API: no text in response')

  return {
    text: textBlock.text,
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    },
  }
}

function parseEnrichmentResponse(
  text: string,
): { properties: Array<{ key: string; draftValue: unknown; rationale: string }>; readyToPaste: Record<string, unknown> } | null {
  let raw = text.trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  }
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1)
  try {
    const parsed = JSON.parse(raw) as {
      properties?: Array<{ key?: string; draftValue?: unknown; rationale?: string }>
      readyToPaste?: Record<string, unknown>
    }
    return {
      properties: (parsed.properties ?? [])
        .filter(p => typeof p.key === 'string')
        .map(p => ({
          key: p.key as string,
          draftValue: p.draftValue ?? null,
          rationale: typeof p.rationale === 'string' ? p.rationale : '',
        })),
      readyToPaste: parsed.readyToPaste ?? {},
    }
  } catch {
    return null
  }
}

export async function draftEnrichment(input: EnrichmentInput): Promise<EnrichmentProposal> {
  if (input.missing.length === 0) {
    return {
      rubricType: input.rubricType,
      properties: [],
      readyToPaste: input.sampleBlock.raw,
      usage: { input_tokens: 0, output_tokens: 0 },
    }
  }
  const systemPrompt = buildSystemPrompt(input.rubricType)
  const userMessage = buildUserMessage(input)
  let usage = { input_tokens: 0, output_tokens: 0 }
  try {
    const llm = await callSonnet(systemPrompt, userMessage)
    usage = llm.usage
    const parsed = parseEnrichmentResponse(llm.text)
    if (!parsed) {
      return {
        rubricType: input.rubricType,
        properties: [],
        readyToPaste: input.sampleBlock.raw,
        usage,
        error: 'LLM returned an unparseable response',
      }
    }
    const byKey = new Map(parsed.properties.map(p => [p.key, p]))
    const properties: EnrichmentProperty[] = input.missing.map(m => {
      const draft = byKey.get(m.key)
      return {
        key: m.key,
        tier: m.tier,
        why: m.why,
        draftValue: draft?.draftValue ?? null,
        rationale: draft?.rationale ?? '',
      }
    })
    return {
      rubricType: input.rubricType,
      properties,
      readyToPaste: parsed.readyToPaste,
      usage,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      rubricType: input.rubricType,
      properties: [],
      readyToPaste: input.sampleBlock.raw,
      usage,
      error: message.slice(0, 300),
    }
  }
}
