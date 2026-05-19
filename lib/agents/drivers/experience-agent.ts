// Experience agent — wraps Google PSI mobile performance score.

import { calculateExperience } from '@/lib/drivers/experience';
import type { DriverResult } from '@/lib/drivers/utils';
import type { Agent, AgentExecutionContext, AgentRunResult } from '../types';

export interface ExperienceInput {
  psiData: Record<string, unknown> | null;
}

export interface ExperienceOutput {
  driverResult: DriverResult;
  interpretation: string;
  appliedGuidance?: string;
}

export const EXPERIENCE_METHODOLOGY = `Misura la performance percepita dall'utente su mobile attraverso i Core Web Vitals di Google.

Sorgente: Google PageSpeed Insights (Lighthouse) — categoria Performance, run su strategy=mobile.

Score = performance_score Lighthouse. Se il valore arriva in scala 0-1 viene moltiplicato per 100, poi clampato a 0-100. Nessuna riponderazione manuale.

Note: PSI è notoriamente rumoroso (varianza ±10 punti tra run vicini). Lo score riflette UNA singola misurazione lab-based.`;

class ExperienceAgent implements Agent<ExperienceInput, ExperienceOutput> {
  readonly name = 'experience';
  readonly label = 'Experience';
  readonly methodology = EXPERIENCE_METHODOLOGY;

  async execute(
    input: ExperienceInput,
    _ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<ExperienceOutput>> {
    const driverResult = calculateExperience(input.psiData);
    const details = driverResult.details ?? {};
    const evidence: string[] = [];
    if (details.performance_score !== undefined) {
      evidence.push(`Lighthouse performance_score (mobile): ${details.performance_score}`);
    }
    if (input.psiData?.lcp !== undefined) evidence.push(`LCP: ${input.psiData.lcp}`);
    if (input.psiData?.cls !== undefined) evidence.push(`CLS: ${input.psiData.cls}`);
    if (input.psiData?.tbt !== undefined) evidence.push(`TBT: ${input.psiData.tbt}`);

    const interpretation = buildInterpretation(driverResult);
    return {
      output: { driverResult, interpretation, appliedGuidance: guidance },
      evidence,
      notes: guidance ? [`Retry guidance applied: ${guidance.slice(0, 200)}`] : undefined,
    };
  }

  summarizeForQuality(result: AgentRunResult<ExperienceOutput>): string {
    const { driverResult, interpretation } = result.output;
    const lines: string[] = [];
    lines.push(`score: ${driverResult.score ?? 'null'} / 100`);
    lines.push(`status: ${driverResult.status}`);
    if (driverResult.details?.performance_score !== undefined) {
      lines.push(`performance_score: ${driverResult.details.performance_score}`);
    }
    lines.push(`interpretation: ${interpretation}`);
    return lines.join('\n');
  }
}

function buildInterpretation(result: DriverResult): string {
  if (result.status !== 'ok' || result.score === null) {
    return 'Experience non calcolabile: PSI non ha restituito un performance score utilizzabile.';
  }
  const s = result.score;
  if (s >= 90) return `Performance mobile eccellente (${s}/100): l'esperienza utente è in linea con i top performer.`;
  if (s >= 75) return `Performance mobile buona (${s}/100): margine di ottimizzazione su LCP/CLS.`;
  if (s >= 50) return `Performance mobile media (${s}/100): da migliorare per ridurre bounce rate.`;
  return `Performance mobile critica (${s}/100): l'utente abbandona prima del rendering completo.`;
}

export const experienceAgent = new ExperienceAgent();
