/**
 * V4 driver — Speed.
 *
 * Source: Google PageSpeed Insights (single source, no fallback).
 * Formula (spec): mean of performance_score * 100 over every
 * (template, strategy) pair. Absolute view = that mean; the leader index over
 * the set gives the Relative view.
 */

import type { DriverWorker } from '@/lib/v4/runner/types'
import { measureSet, psiOutcome } from './pagespeed'

export const speedWorker: DriverWorker = async (ctx) => {
  const result = await measureSet(ctx, 'performance')
  return psiOutcome(ctx, 'performance', result, 'Speed')
}
