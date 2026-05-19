// Compliance agent — wraps SEMrush Site Health score.

import { calculateCompliance } from '@/lib/drivers/compliance';
import type { DriverResult } from '@/lib/drivers/utils';
import type { Agent, AgentExecutionContext, AgentRunResult } from '../types';

export interface ComplianceInput {
  siteHealthData: Record<string, unknown> | null;
}

export interface ComplianceOutput {
  driverResult: DriverResult;
  interpretation: string;
  appliedGuidance?: string;
}

export const COMPLIANCE_METHODOLOGY = `Misura la salute tecnica del dominio: crawl errors, redirect rotti, meta tag duplicati/mancanti, problemi HTTPS, broken links.

Sorgente: SEMrush Site Audit — campo site_health_score (0-100). Quando assente, fallback a quality.value della stessa risposta.

Score = site_health_score direttamente (no riponderazione). Status 'ok' quando lo score è derivabile, 'failed' quando il payload c'è ma non contiene il campo.`;

class ComplianceAgent implements Agent<ComplianceInput, ComplianceOutput> {
  readonly name = 'compliance';
  readonly label = 'Compliance';
  readonly methodology = COMPLIANCE_METHODOLOGY;

  async execute(
    input: ComplianceInput,
    _ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<ComplianceOutput>> {
    const driverResult = calculateCompliance(input.siteHealthData);
    const details = driverResult.details ?? {};
    const evidence: string[] = [];
    if (details.site_health_score !== undefined) {
      evidence.push(`SEMrush site_health_score: ${details.site_health_score}`);
    } else {
      evidence.push('No site_health_score in SEMrush Site Audit response');
    }

    const interpretation = buildInterpretation(driverResult);
    return {
      output: { driverResult, interpretation, appliedGuidance: guidance },
      evidence,
      notes: guidance ? [`Retry guidance applied: ${guidance.slice(0, 200)}`] : undefined,
    };
  }

  summarizeForQuality(result: AgentRunResult<ComplianceOutput>): string {
    const { driverResult, interpretation } = result.output;
    const lines: string[] = [];
    lines.push(`score: ${driverResult.score ?? 'null'} / 100`);
    lines.push(`status: ${driverResult.status}`);
    if (driverResult.details?.site_health_score !== undefined) {
      lines.push(`site_health_score: ${driverResult.details.site_health_score}`);
    }
    lines.push(`interpretation: ${interpretation}`);
    return lines.join('\n');
  }
}

function buildInterpretation(result: DriverResult): string {
  if (result.status !== 'ok' || result.score === null) {
    return 'Compliance non calcolabile: SEMrush Site Audit non ha restituito uno score utile.';
  }
  const s = result.score;
  if (s >= 90) return `Sito tecnicamente pulito (${s}/100). Marginal gains su issues residue.`;
  if (s >= 70) return `Salute tecnica buona (${s}/100), con qualche pulizia da fare su redirect/meta tag.`;
  if (s >= 50) return `Salute tecnica media (${s}/100): conviene investire su un audit dedicato.`;
  return `Salute tecnica critica (${s}/100): broken link e errori di crawl penalizzano il ranking.`;
}

export const complianceAgent = new ComplianceAgent();
