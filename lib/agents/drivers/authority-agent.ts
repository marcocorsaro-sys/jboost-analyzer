// Authority agent — wraps Ahrefs Domain Rating.

import { calculateAuthority } from '@/lib/drivers/authority';
import type { DriverResult } from '@/lib/drivers/utils';
import type { Agent, AgentExecutionContext, AgentRunResult } from '../types';

export interface AuthorityInput {
  ahrefsData: Record<string, unknown> | null;
}

export interface AuthorityOutput {
  driverResult: DriverResult;
  interpretation: string;
  appliedGuidance?: string;
}

export const AUTHORITY_METHODOLOGY = `Misura l'autorevolezza del dominio basata sul profilo backlink.

Sorgente: Ahrefs Domain Rating (DR) — score proprietario 0-100 calcolato da Ahrefs su qualità + quantità + diversità dei domini referenti.

Score = domain_rating direttamente (no riponderazione). Quando Ahrefs ritorna 403/rate-limited, fallback a mock DR=50 (status 'ok' ma flag _meta.is_mock=true per audit).

Status 'ok' su risposta valida o mock. 'no_results' quando il payload è null, 'failed' su errore di parsing.`;

class AuthorityAgent implements Agent<AuthorityInput, AuthorityOutput> {
  readonly name = 'authority';
  readonly label = 'Authority';
  readonly methodology = AUTHORITY_METHODOLOGY;

  async execute(
    input: AuthorityInput,
    _ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<AuthorityOutput>> {
    const driverResult = calculateAuthority(input.ahrefsData);
    const details = driverResult.details ?? {};
    const evidence: string[] = [];
    if (details.domain_rating !== undefined) {
      evidence.push(`Ahrefs Domain Rating: ${details.domain_rating}`);
    }
    if (details.ahrefs_rank !== undefined) {
      evidence.push(`Ahrefs global rank: ${details.ahrefs_rank}`);
    }
    if (details.is_mock) {
      evidence.push(`⚠ Mock fallback used (Ahrefs API not available)`);
    }

    const interpretation = buildInterpretation(driverResult);
    return {
      output: { driverResult, interpretation, appliedGuidance: guidance },
      evidence,
      notes: guidance ? [`Retry guidance applied: ${guidance.slice(0, 200)}`] : undefined,
    };
  }

  summarizeForQuality(result: AgentRunResult<AuthorityOutput>): string {
    const { driverResult, interpretation } = result.output;
    const lines: string[] = [];
    lines.push(`score: ${driverResult.score ?? 'null'} / 100`);
    lines.push(`status: ${driverResult.status}`);
    const d = driverResult.details;
    if (d?.domain_rating !== undefined) lines.push(`domain_rating: ${d.domain_rating}`);
    if (d?.is_mock) lines.push(`is_mock: true (Ahrefs API not available)`);
    lines.push(`interpretation: ${interpretation}`);
    return lines.join('\n');
  }
}

function buildInterpretation(result: DriverResult): string {
  if (result.status !== 'ok' || result.score === null) {
    return 'Authority non calcolabile: Ahrefs non ha restituito Domain Rating.';
  }
  const s = result.score;
  const mockNote = result.details?.is_mock ? ' (valore mock fallback)' : '';
  if (s >= 70) return `Autorevolezza molto alta (DR ${s})${mockNote}: profilo backlink robusto e diversificato.`;
  if (s >= 50) return `Autorevolezza solida (DR ${s})${mockNote}: link building costante in atto.`;
  if (s >= 30) return `Autorevolezza media (DR ${s})${mockNote}: serve outreach mirato per scalare.`;
  return `Autorevolezza bassa (DR ${s})${mockNote}: il profilo backlink limita il ranking potenziale.`;
}

export const authorityAgent = new AuthorityAgent();
