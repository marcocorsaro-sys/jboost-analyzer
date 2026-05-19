// ASO Visibility agent — wraps SEMrush adwords metrics.

import { calculateAsoVisibility } from '@/lib/drivers/aso-visibility';
import type { DriverResult } from '@/lib/drivers/utils';
import type { Agent, AgentExecutionContext, AgentRunResult } from '../types';

export interface AsoVisibilityInput {
  domainRankData: Record<string, unknown> | null;
}

export interface AsoVisibilityOutput {
  driverResult: DriverResult;
  interpretation: string;
  appliedGuidance?: string;
}

export const ASO_VISIBILITY_METHODOLOGY = `Misura la presenza paid del dominio: keyword acquistate, traffico paid, intensità delle campagne ads.

Sorgente: SEMrush Domain Overview — campi adwordsKeywords (Ad), adwordsTraffic (At), Rk come fallback.

Formula primaria (quando ci sono adwords data):
  kw_part = (log10(adwordsKeywords) / 5) × 100
  traffic_part = (log10(adwordsTraffic) / 7) × 100
  score = media delle parts disponibili.

Formula fallback (no adwords data, solo rank): score = (100 - min(90, log10(rank) × 20)) × 0.6. Indicatore indiretto, moltiplicato per 0.6 per riflettere la minore affidabilità.`;

class AsoVisibilityAgent implements Agent<AsoVisibilityInput, AsoVisibilityOutput> {
  readonly name = 'aso_visibility';
  readonly label = 'ASO Visibility';
  readonly methodology = ASO_VISIBILITY_METHODOLOGY;

  async execute(
    input: AsoVisibilityInput,
    _ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<AsoVisibilityOutput>> {
    const driverResult = calculateAsoVisibility(input.domainRankData);
    const details = driverResult.details ?? {};
    const evidence: string[] = [];
    if (details.adwordsKeywords) evidence.push(`Adwords keywords: ${details.adwordsKeywords}`);
    if (details.adwordsTraffic) evidence.push(`Adwords traffic estimate: ${details.adwordsTraffic}`);
    if (details.rank) evidence.push(`SEMrush global rank: ${details.rank}`);
    if (!details.adwordsKeywords && !details.adwordsTraffic && details.rank) {
      evidence.push('Using rank-based fallback (×0.6 indirect indicator)');
    }

    const interpretation = buildInterpretation(driverResult);
    return {
      output: { driverResult, interpretation, appliedGuidance: guidance },
      evidence,
      notes: guidance ? [`Retry guidance applied: ${guidance.slice(0, 200)}`] : undefined,
    };
  }

  summarizeForQuality(result: AgentRunResult<AsoVisibilityOutput>): string {
    const { driverResult, interpretation } = result.output;
    const lines: string[] = [];
    lines.push(`score: ${driverResult.score ?? 'null'} / 100`);
    lines.push(`status: ${driverResult.status}`);
    const d = driverResult.details;
    if (d?.adwordsKeywords !== undefined) lines.push(`adwords_keywords: ${d.adwordsKeywords}`);
    if (d?.adwordsTraffic !== undefined) lines.push(`adwords_traffic: ${d.adwordsTraffic}`);
    if (d?.rank !== undefined) lines.push(`rank: ${d.rank}`);
    lines.push(`interpretation: ${interpretation}`);
    return lines.join('\n');
  }
}

function buildInterpretation(result: DriverResult): string {
  if (result.status !== 'ok' || result.score === null) {
    return 'ASO Visibility non calcolabile: nessun dato adwords + rank assente.';
  }
  const s = result.score;
  const d = result.details;
  const noAds = !d?.adwordsKeywords && !d?.adwordsTraffic;
  if (noAds) return `Score ${s}/100 derivato da rank-based fallback. Nessuna campagna paid attiva detectata.`;
  if (s >= 70) return `Presenza paid molto forte (${s}/100): campagne ads ampie e ben distribuite.`;
  if (s >= 40) return `Presenza paid media (${s}/100): campagne attive ma con copertura limitata.`;
  return `Presenza paid bassa (${s}/100): poche keyword acquistate, opportunità di scaling.`;
}

export const asoVisibilityAgent = new AsoVisibilityAgent();
