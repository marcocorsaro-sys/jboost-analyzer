// Awareness agent — wraps SEMrush brand awareness (latest rank + traffic).

import { calculateAwareness } from '@/lib/drivers/awareness';
import type { DriverResult } from '@/lib/drivers/utils';
import type { Agent, AgentExecutionContext, AgentRunResult } from '../types';

export interface AwarenessInput {
  trendsData: Record<string, unknown> | null;
}

export interface AwarenessOutput {
  driverResult: DriverResult;
  interpretation: string;
  appliedGuidance?: string;
}

export const AWARENESS_METHODOLOGY = `Misura la "brand awareness" usando il rank corrente del dominio e l'evoluzione recente del traffico.

Sorgente: SEMrush domain_rank_history — campi latestRank, average, latest.

Formula primaria (rank-based): score = 100 - min(90, log10(latestRank) × 20). Più basso il rank, più alto lo score.

Formula fallback (no rank, solo traffic): score = min(100, log10(traffic) × 10) usando average o latest come stima.

Note: lo score non distingue tra traffic da branded vs non-branded queries. La awareness vera richiede integrazione con Google Trends (roadmap).`;

class AwarenessAgent implements Agent<AwarenessInput, AwarenessOutput> {
  readonly name = 'awareness';
  readonly label = 'Awareness';
  readonly methodology = AWARENESS_METHODOLOGY;

  async execute(
    input: AwarenessInput,
    _ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<AwarenessOutput>> {
    const driverResult = calculateAwareness(input.trendsData);
    const details = driverResult.details ?? {};
    const evidence: string[] = [];
    if (details.latestRank) evidence.push(`Latest SEMrush rank: ${details.latestRank}`);
    if (details.average) evidence.push(`Average traffic (recent): ${details.average}`);
    if (details.latest) evidence.push(`Latest traffic snapshot: ${details.latest}`);
    if (details.noResults) evidence.push('SEMrush returned mock — no real awareness signal');

    const interpretation = buildInterpretation(driverResult);
    return {
      output: { driverResult, interpretation, appliedGuidance: guidance },
      evidence,
      notes: guidance ? [`Retry guidance applied: ${guidance.slice(0, 200)}`] : undefined,
    };
  }

  summarizeForQuality(result: AgentRunResult<AwarenessOutput>): string {
    const { driverResult, interpretation } = result.output;
    const lines: string[] = [];
    lines.push(`score: ${driverResult.score ?? 'null'} / 100`);
    lines.push(`status: ${driverResult.status}`);
    const d = driverResult.details;
    if (d?.latestRank !== undefined) lines.push(`latest_rank: ${d.latestRank}`);
    if (d?.average !== undefined) lines.push(`avg_traffic: ${d.average}`);
    if (d?.latest !== undefined) lines.push(`latest_traffic: ${d.latest}`);
    lines.push(`interpretation: ${interpretation}`);
    return lines.join('\n');
  }
}

function buildInterpretation(result: DriverResult): string {
  if (result.status !== 'ok' || result.score === null) {
    return 'Awareness non calcolabile: SEMrush non ha dati di rank history per il dominio.';
  }
  const s = result.score;
  if (s >= 70) return `Brand awareness alta (${s}/100): il dominio è ben presente nei motori di ricerca.`;
  if (s >= 40) return `Brand awareness media (${s}/100): visibilità consistente ma migliorabile.`;
  return `Brand awareness bassa (${s}/100): poco riconoscimento da parte del traffico organico.`;
}

export const awarenessAgent = new AwarenessAgent();
