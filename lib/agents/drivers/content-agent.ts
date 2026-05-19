// Content agent — wraps SEMrush Site Audit error ratio.

import { calculateContent } from '@/lib/drivers/content';
import type { DriverResult } from '@/lib/drivers/utils';
import type { Agent, AgentExecutionContext, AgentRunResult } from '../types';

export interface ContentInput {
  siteHealthData: Record<string, unknown> | null;
}

export interface ContentOutput {
  driverResult: DriverResult;
  interpretation: string;
  appliedGuidance?: string;
}

export const CONTENT_METHODOLOGY = `Misura la qualità del contenuto pubblicato in termini di errori critici (404, duplicate content, thin content, missing tags).

Sorgente: SEMrush Site Audit — array issues[] (type='error') + meta.pages_crawled.

Formula: errorRatio = totalErrorPages / pagesCrawled. Score = max(1, 100 × e^(-errorRatio)). Decay esponenziale: pochissimi errori → score alto, molti errori → score precipita.

Status 'ok' quando issues e pages_crawled sono entrambi disponibili, altrimenti 'failed'/'no_results'.`;

class ContentAgent implements Agent<ContentInput, ContentOutput> {
  readonly name = 'content';
  readonly label = 'Content';
  readonly methodology = CONTENT_METHODOLOGY;

  async execute(
    input: ContentInput,
    _ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<ContentOutput>> {
    const driverResult = calculateContent(input.siteHealthData);
    const details = driverResult.details ?? {};
    const evidence: string[] = [];
    if (details.pagesCrawled !== undefined) evidence.push(`Pages crawled: ${details.pagesCrawled}`);
    if (details.totalErrorPages !== undefined) evidence.push(`Pages with errors: ${details.totalErrorPages}`);
    if (details.errorRatio !== undefined) evidence.push(`Error ratio: ${details.errorRatio}`);

    const interpretation = buildInterpretation(driverResult);
    return {
      output: { driverResult, interpretation, appliedGuidance: guidance },
      evidence,
      notes: guidance ? [`Retry guidance applied: ${guidance.slice(0, 200)}`] : undefined,
    };
  }

  summarizeForQuality(result: AgentRunResult<ContentOutput>): string {
    const { driverResult, interpretation } = result.output;
    const lines: string[] = [];
    lines.push(`score: ${driverResult.score ?? 'null'} / 100`);
    lines.push(`status: ${driverResult.status}`);
    const d = driverResult.details;
    if (d?.pagesCrawled !== undefined) lines.push(`pages_crawled: ${d.pagesCrawled}`);
    if (d?.totalErrorPages !== undefined) lines.push(`error_pages: ${d.totalErrorPages}`);
    if (d?.errorRatio !== undefined) lines.push(`error_ratio: ${d.errorRatio}`);
    lines.push(`interpretation: ${interpretation}`);
    return lines.join('\n');
  }
}

function buildInterpretation(result: DriverResult): string {
  if (result.status !== 'ok' || result.score === null) {
    return 'Content non calcolabile: il Site Audit non ha restituito issues + pages_crawled.';
  }
  const s = result.score;
  if (s >= 90) return `Qualità contenuto eccellente (${s}/100): pochissimi errori sui ${result.details?.pagesCrawled ?? '—'} pagine analizzate.`;
  if (s >= 70) return `Qualità contenuto buona (${s}/100): alcune pagine con errori da sistemare.`;
  if (s >= 40) return `Qualità contenuto media (${s}/100): troppi 404/duplicates penalizzano il crawling.`;
  return `Qualità contenuto critica (${s}/100): error ratio ${result.details?.errorRatio ?? '—'}, intervento urgente.`;
}

export const contentAgent = new ContentAgent();
