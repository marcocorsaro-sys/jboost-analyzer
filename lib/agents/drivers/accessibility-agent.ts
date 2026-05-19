// Accessibility agent — wraps Google PSI accessibility score.

import { calculateAccessibility } from '@/lib/drivers/accessibility';
import type { DriverResult } from '@/lib/drivers/utils';
import type { Agent, AgentExecutionContext, AgentRunResult } from '../types';

export interface AccessibilityInput {
  psiData: Record<string, unknown> | null;
}

export interface AccessibilityOutput {
  driverResult: DriverResult;
  interpretation: string;
  appliedGuidance?: string;
}

export const ACCESSIBILITY_METHODOLOGY = `Misura il rispetto delle linee guida WCAG (alt text, contrasto, struttura semantica, tab order).

Sorgente: Google PageSpeed Insights (Lighthouse) — categoria Accessibility.

Score = accessibility_score Lighthouse. Se in scala 0-1 viene moltiplicato per 100, poi clampato a 0-100.

Note: Lighthouse audita solo gli aspetti misurabili automaticamente (~30% dei criteri WCAG). Score alto non garantisce accessibilità totale.`;

class AccessibilityAgent implements Agent<AccessibilityInput, AccessibilityOutput> {
  readonly name = 'accessibility';
  readonly label = 'Accessibility';
  readonly methodology = ACCESSIBILITY_METHODOLOGY;

  async execute(
    input: AccessibilityInput,
    _ctx: AgentExecutionContext,
    guidance?: string,
  ): Promise<AgentRunResult<AccessibilityOutput>> {
    const driverResult = calculateAccessibility(input.psiData);
    const details = driverResult.details ?? {};
    const evidence: string[] = [];
    if (details.accessibility_score !== undefined) {
      evidence.push(`Lighthouse accessibility_score: ${details.accessibility_score}`);
    }

    const interpretation = buildInterpretation(driverResult);
    return {
      output: { driverResult, interpretation, appliedGuidance: guidance },
      evidence,
      notes: guidance ? [`Retry guidance applied: ${guidance.slice(0, 200)}`] : undefined,
    };
  }

  summarizeForQuality(result: AgentRunResult<AccessibilityOutput>): string {
    const { driverResult, interpretation } = result.output;
    const lines: string[] = [];
    lines.push(`score: ${driverResult.score ?? 'null'} / 100`);
    lines.push(`status: ${driverResult.status}`);
    if (driverResult.details?.accessibility_score !== undefined) {
      lines.push(`accessibility_score: ${driverResult.details.accessibility_score}`);
    }
    lines.push(`interpretation: ${interpretation}`);
    return lines.join('\n');
  }
}

function buildInterpretation(result: DriverResult): string {
  if (result.status !== 'ok' || result.score === null) {
    return 'Accessibility non calcolabile: PSI non ha restituito il sotto-score Accessibility.';
  }
  const s = result.score;
  if (s >= 95) return `Accessibilità eccellente (${s}/100): tutti i check automatici WCAG superati.`;
  if (s >= 80) return `Accessibilità buona (${s}/100): qualche aria-label / contrasto residuo.`;
  if (s >= 60) return `Accessibilità media (${s}/100): rischio compliance, manca alt-text e label.`;
  return `Accessibilità critica (${s}/100): problemi gravi su contrasto, struttura semantica, alt-text.`;
}

export const accessibilityAgent = new AccessibilityAgent();
