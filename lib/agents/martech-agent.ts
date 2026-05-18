// Pilot agent #2 — MarTech.
//
// Wraps detectMartechStack (LLM-native via Firecrawl + Sonnet when
// FIRECRAWL_API_KEY is set, hybrid otherwise) in the Agent abstraction.
// On a quality 'retry' verdict, the agent re-runs detection with a
// retry tag in console logs so we can correlate. PR1 keeps re-runs
// data-equivalent (same domain, same pipeline) — the next iteration
// can flow `guidance` into the LLM prompt itself for cheaper, smarter
// retries.

import { detectMartechStack } from '@/lib/martech/detect';
import type { DetectionResult } from '@/lib/martech/detect';
import type { Agent, AgentExecutionContext, AgentRunResult } from './types';

export interface MartechInput {
  domain: string;
}

export interface MartechOutput {
  detection: DetectionResult;
  /** Echo of guidance the agent absorbed on this attempt. */
  appliedGuidance?: string;
}

export const MARTECH_METHODOLOGY = `Scansiona il dominio del cliente e identifica lo stack tecnologico/marketing in uso.

Pipeline preferita (quando FIRECRAWL_API_KEY è configurata): Firecrawl effettua uno scrape headless della homepage (gestisce JS challenges e Cloudflare nativamente), poi Claude Sonnet 4.6 analizza HTML + markdown renderizzati e identifica tools con evidenza concreta (script src, JSON-LD, cookie noti, meta tag).

Pipeline fallback: fetch HTML diretto + pattern matching (Wappalyzer-style) + AI web-search Anthropic + DataForSEO domain_technologies in caso di bot protection.

Per ogni tool restituisce: category (cms, analytics, tag_manager, ...), tool_name, version, confidence (0-1), evidence. Calcola anche un maturity_score 0-100, un gap_analysis e 3-5 raccomandazioni prioritizzate.

GROUNDING: ogni tool DEVE avere un'evidenza concreta nel content scrapeato. Senza evidenza, il tool viene omesso.`;

class MartechAgent implements Agent<MartechInput, MartechOutput> {
  readonly name = 'martech';
  readonly label = 'MarTech Stack';
  readonly methodology = MARTECH_METHODOLOGY;

  async execute(
    input: MartechInput,
    _ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<MartechOutput>> {
    if (guidance) {
      console.log(`[agent:martech] retry attempt with quality guidance: ${guidance.slice(0, 200)}`);
    }
    const detection = await detectMartechStack(input.domain);

    const evidence: string[] = [];
    for (const tool of detection.tools.slice(0, 15)) {
      const ev = (tool.details?.evidence as string | undefined) ?? '';
      evidence.push(`${tool.category}/${tool.tool_name}${tool.tool_version ? ` v${tool.tool_version}` : ''}${ev ? ` — ${ev.slice(0, 120)}` : ''}`);
    }
    if (detection.completeness?.diagnostics) {
      for (const d of detection.completeness.diagnostics.slice(0, 5)) {
        evidence.push(`[${d.type}] ${d.message}`);
      }
    }

    const notes: string[] = [];
    if (guidance) notes.push(`Retry guidance applied: ${guidance.slice(0, 200)}`);
    notes.push(`pages_scanned: ${detection.completeness?.pagesScanned ?? 0}`);

    return {
      output: { detection, appliedGuidance: guidance },
      evidence,
      usage: detection.usage
        ? { input_tokens: detection.usage.input_tokens, output_tokens: detection.usage.output_tokens }
        : undefined,
      notes,
    };
  }

  summarizeForQuality(result: AgentRunResult<MartechOutput>): string {
    const { detection } = result.output;
    const lines: string[] = [];
    lines.push(`tools_detected: ${detection.tools.length}`);
    lines.push(`maturity_score: ${detection.maturityScore} (${detection.maturityTier})`);
    lines.push(`completeness: ${detection.completeness?.score ?? 'n/a'}/100 (${detection.completeness?.level ?? 'n/a'})`);
    lines.push(`gap_analysis_items: ${detection.gapAnalysis.length}`);
    lines.push(`recommendations: ${detection.recommendations.length}`);

    // List the categories with at least one tool, ranked by tool count.
    const byCat: Record<string, number> = {};
    for (const t of detection.tools) byCat[t.category] = (byCat[t.category] ?? 0) + 1;
    const catList = Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([k, n]) => `${k}(${n})`)
      .join(', ');
    if (catList) lines.push(`categories: ${catList}`);

    // Surface the top-confidence tools per essential category.
    const essential = ['cms', 'analytics', 'tag_manager'];
    for (const cat of essential) {
      const tools = detection.tools.filter(t => t.category === cat);
      if (tools.length === 0) {
        lines.push(`essential[${cat}]: MISSING`);
      } else {
        const best = tools.reduce((a, b) => (b.confidence > a.confidence ? b : a));
        lines.push(`essential[${cat}]: ${best.tool_name} (conf=${best.confidence.toFixed(2)})`);
      }
    }
    return lines.join('\n');
  }
}

export const martechAgent = new MartechAgent();
