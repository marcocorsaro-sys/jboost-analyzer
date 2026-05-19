// Pilot agent #1 — AI Relevance.
//
// Wraps the deterministic `calculateAiRelevance` driver in the Agent
// abstraction so it gets a quality loop. The methodology is plain
// "interpret AI Overview / Featured Snippet presence on live SERP";
// on retry, the agent re-interprets the same raw data under the
// quality judge's guidance (e.g. "weight DataForSEO higher than
// Ahrefs fallback", "ignore low-volume tail keywords").
//
// PR1 scope: we do NOT add new data fetches on retry — the data flows
// in unchanged from phase 1 of the orchestrator. The "agentic" part
// is the quality loop + methodology surfacing. A future PR can let
// the agent trigger an additional DataForSEO scan on retry.

import { calculateAiRelevance } from '@/lib/drivers/ai-relevance';
import type { DriverResult } from '@/lib/drivers/utils';
import type { Agent, AgentExecutionContext, AgentRunResult } from '../types';

export interface AiRelevanceInput {
  ahrefsAiData: Record<string, unknown> | null;
  dataforseoAiData: Record<string, unknown> | null;
}

export interface AiRelevanceOutput {
  driverResult: DriverResult;
  /** Interpretation paragraph the agent attaches alongside the score —
   *  one sentence on what the score means + one sentence on the
   *  confidence level. Surfaced to the user. */
  interpretation: string;
  /** Source the score was derived from. */
  source: 'dataforseo_serp_live' | 'ahrefs_organic_keywords' | 'none';
  /** Guidance the agent absorbed on this attempt (echo, for audit). */
  appliedGuidance?: string;
}

export const AI_RELEVANCE_METHODOLOGY = `Analizza la visibilità del dominio dentro le risposte generative dei motori di ricerca (AI Overview, Featured Snippet, People Also Ask).

Sorgente preferita: DataForSEO live SERP scan — interroga keyword reali del cliente e misura la % di SERP in cui compaiono blocchi AI Overview / Featured Snippet, restituendo aiOverviewPercentage.

Sorgente fallback: Ahrefs organic-keywords — usa i SERP features statici aggregati da Ahrefs per stimare la stessa metrica quando DataForSEO non è disponibile o ritorna vuoto.

Score = aiOverviewPercentage (DFSEO) oppure ((aiOverviewCount + featuredSnippetCount) / totalKeywords) × 100 (Ahrefs).

Status 'ok' quando lo score è calcolabile e ha almeno una keyword di base. Status 'no_results' quando nessuna delle due sorgenti restituisce dati utili.`;

class AiRelevanceAgent implements Agent<AiRelevanceInput, AiRelevanceOutput> {
  readonly name = 'ai_relevance';
  readonly label = 'AI Relevance';
  readonly methodology = AI_RELEVANCE_METHODOLOGY;

  async execute(
    input: AiRelevanceInput,
    _ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<AiRelevanceOutput>> {
    const driverResult = calculateAiRelevance(input.ahrefsAiData, input.dataforseoAiData);

    const details = driverResult.details ?? {};
    const source = (details.source as AiRelevanceOutput['source']) ?? 'none';

    const evidence: string[] = [];
    if (source === 'dataforseo_serp_live') {
      evidence.push(`DataForSEO live SERP: ${details.successful_keywords}/${details.total_keywords} keywords scanned`);
      if (details.ai_overview_keywords !== undefined) {
        evidence.push(`AI Overview present on ${details.ai_overview_keywords} keywords`);
      }
      if (details.featured_snippet_keywords !== undefined) {
        evidence.push(`Featured Snippet on ${details.featured_snippet_keywords} keywords`);
      }
      if (details.people_also_ask_keywords !== undefined) {
        evidence.push(`People Also Ask on ${details.people_also_ask_keywords} keywords`);
      }
    } else if (source === 'ahrefs_organic_keywords') {
      evidence.push(`Ahrefs fallback: ${details.total_keywords} keywords from organic ranking`);
      if (details.ai_overview_keywords !== undefined) {
        evidence.push(`AI Overview features on ${details.ai_overview_keywords} keywords`);
      }
    } else {
      evidence.push('No AI Relevance data sources returned usable results');
    }

    const interpretation = buildInterpretation(driverResult, source);

    return {
      output: {
        driverResult,
        interpretation,
        source,
        appliedGuidance: guidance,
      },
      evidence,
      notes: guidance ? [`Retry guidance applied: ${guidance.slice(0, 200)}`] : undefined,
    };
  }

  summarizeForQuality(result: AgentRunResult<AiRelevanceOutput>): string {
    const { driverResult, source, interpretation } = result.output;
    const details = driverResult.details ?? {};
    const lines: string[] = [];
    lines.push(`score: ${driverResult.score ?? 'null'} / 100`);
    lines.push(`status: ${driverResult.status}`);
    lines.push(`source: ${source}`);
    if (details.total_keywords !== undefined) {
      lines.push(`total_keywords: ${details.total_keywords}`);
    }
    if (details.ai_overview_keywords !== undefined) {
      lines.push(`ai_overview_keywords: ${details.ai_overview_keywords}`);
    }
    if (details.featured_snippet_keywords !== undefined) {
      lines.push(`featured_snippet_keywords: ${details.featured_snippet_keywords}`);
    }
    lines.push(`interpretation: ${interpretation}`);
    return lines.join('\n');
  }
}

function buildInterpretation(result: DriverResult, source: string): string {
  if (result.status !== 'ok' || result.score === null) {
    return 'AI Relevance non calcolabile: nessuna sorgente ha restituito dati utili.';
  }
  const score = result.score;
  let band = '';
  if (score >= 70) band = 'forte presenza nelle risposte AI dei motori di ricerca';
  else if (score >= 40) band = 'presenza media nelle risposte AI — ci sono margini di crescita';
  else band = 'presenza debole: la maggior parte delle SERP non include il dominio nei blocchi AI';
  const confidence = source === 'dataforseo_serp_live'
    ? 'dato verificato su SERP live (alta confidenza)'
    : source === 'ahrefs_organic_keywords'
      ? 'stimato da SERP features Ahrefs (confidenza media)'
      : 'confidenza bassa';
  return `${band}. Misura: ${confidence}.`;
}

export const aiRelevanceAgent = new AiRelevanceAgent();
