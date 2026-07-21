/**
 * V4 driver — Accessibility.
 *
 * Source: Google PageSpeed Insights, the same Lighthouse run as Speed
 * (spec: "stessa chiamata di Speed"), reading the accessibility category
 * instead of performance.
 *
 * Speed and Accessibility are separate jobs in separate invocations, so each
 * one issues its own PSI request rather than sharing a cached Lighthouse run.
 * PSI is free and quota-generous; a cross-job cache would buy nothing and cost
 * a coordination path that can go stale. Revisit if the quota ever bites.
 */

import type { DriverWorker } from '@/lib/v4/runner/types'
import { measureSet, psiOutcome } from './pagespeed'

export const accessibilityWorker: DriverWorker = async (ctx) => {
  const result = await measureSet(ctx, 'accessibility')
  return psiOutcome(ctx, 'accessibility', result, 'Accessibility')
}
