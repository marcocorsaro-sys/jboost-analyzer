// Discoverability agent — wraps SEMrush domain rank + organic traffic.

import { calculateDiscoverability } from '@/lib/drivers/discoverability';
import type { DriverResult } from '@/lib/drivers/utils';
import type { Agent, AgentExecutionContext, AgentRunResult } from '../types';

export interface DiscoverabilityInput {
  domainRankData: Record<string, unknown> | null;
}

export interface DiscoverabilityOutput {
  driverResult: DriverResult;
  interpretation: string;
  appliedGuidance?: string;
}

export const DISCOVERABILITY_METHODOLOGY = `Misura la visibilità organica del dominio nei motori di ricerca.

Sorgente: SEMrush Domain Overview — campi Rk (rank globale), Ot (organic traffic), Or (organic keywords).

Formula (primaria, basata sul rank): score = 100 - min(90, log10(rank) × 20). Più basso è il rank, più alto è lo score.

Fallback (quando il rank non è disponibile): media tra (log10(organicTraffic)/8 × 100) e (log10(organicKeywords)/7 × 100).

Status 'ok' quando lo score è derivabile, 'no_results' quando il dominio non è indicizzato da SEMrush.`;

class DiscoverabilityAgent implements Agent<DiscoverabilityInput, DiscoverabilityOutput> {
  readonly name = 'discoverability';
  readonly label = 'Discoverability';
  readonly methodology = DISCOVERABILITY_METHODOLOGY;

  async execute(
    input: DiscoverabilityInput,
    _ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<DiscoverabilityOutput>> {
    const driverResult = calculateDiscoverability(input.domainRankData);
    const details = driverResult.details ?? {};
    const evidence: string[] = [];
    if (details.rank !== undefined && details.rank !== 0) {
      evidence.push(`SEMrush global rank: ${details.rank}`);
    }
    if (details.organicTraffic !== undefined) {
      evidence.push(`Organic traffic (monthly estimate): ${details.organicTraffic}`);
    }
    if (details.organicKeywords !== undefined) {
      evidence.push(`Organic keywords ranking: ${details.organicKeywords}`);
    }

    const interpretation = buildInterpretation(driverResult);
    return {
      output: { driverResult, interpretation, appliedGuidance: guidance },
      evidence,
      notes: guidance ? [`Retry guidance applied: ${guidance.slice(0, 200)}`] : undefined,
    };
  }

  summarizeForQuality(result: AgentRunResult<DiscoverabilityOutput>): string {
    const { driverResult, interpretation } = result.output;
    const lines: string[] = [];
    lines.push(`score: ${driverResult.score ?? 'null'} / 100`);
    lines.push(`status: ${driverResult.status}`);
    const d = driverResult.details;
    if (d?.rank !== undefined) lines.push(`rank: ${d.rank}`);
    if (d?.organicTraffic !== undefined) lines.push(`organic_traffic: ${d.organicTraffic}`);
    if (d?.organicKeywords !== undefined) lines.push(`organic_keywords: ${d.organicKeywords}`);
    lines.push(`interpretation: ${interpretation}`);
    return lines.join('\n');
  }
}

function buildInterpretation(result: DriverResult): string {
  if (result.status !== 'ok' || result.score === null) {
    return 'Discoverability non calcolabile: SEMrush non ha indicizzato il dominio o non ritorna dati utili.';
  }
  const s = result.score;
  if (s >= 80) return `Visibilità organica molto alta (${s}/100): il dominio rankia su molte keyword.`;
  if (s >= 60) return `Visibilità organica solida (${s}/100): copertura keyword buona, c'è spazio sui topical gap.`;
  if (s >= 40) return `Visibilità organica media (${s}/100): pochi cluster di keyword presidiati.`;
  return `Visibilità organica bassa (${s}/100): il dominio è praticamente invisibile in SERP.`;
}

export const discoverabilityAgent = new DiscoverabilityAgent();
