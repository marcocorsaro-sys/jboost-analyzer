/**
 * V4 runner — driver worker registry.
 *
 * This is the seam the whole Block 2 exists to create: the runner knows how to
 * queue, claim, lease, retry, normalize and reap a driver job, and it reaches
 * the actual measurement through exactly one function per driver.
 *
 * All ten keys now resolve to a real worker (blocks 4 and 5), with two that
 * are deliberately not measurements:
 *   - ai_visibility pauses on needs_decision — the score is typed in from
 *     J-Horizon, there is no API by design.
 *   - traffic refuses, naming the SimilarWeb source it needs and why the
 *     Semrush/Ahrefs numbers on hand are not a substitute.
 *
 * Both are failures that SAY what is missing. That is the point: a placeholder
 * returning 0 or a mock number would be the exact V1 bug the V4 spec calls out
 * by name — Ariston scoring 0/100 on Schema because a detection failure was
 * written as a real measurement.
 */

import type { V4DriverKey } from '@/lib/scoring/registry'
import type { DriverWorker } from './types'
import { authorityWorker } from '@/lib/v4/drivers/authority'
import { speedWorker } from '@/lib/v4/drivers/speed'
import { accessibilityWorker } from '@/lib/v4/drivers/accessibility'
import { complianceWorker } from '@/lib/v4/drivers/compliance'
import { discoverabilityWorker } from '@/lib/v4/drivers/discoverability'
import { awarenessWorker } from '@/lib/v4/drivers/awareness'
import { contentWorker } from '@/lib/v4/drivers/content'
import { aiVisibilityWorker } from '@/lib/v4/drivers/ai-visibility'
import { trafficWorker } from '@/lib/v4/drivers/traffic'
import { schemaWorker } from '@/lib/v4/drivers/schema'

/**
 * driver_key -> worker. Register a real implementation here and the runner
 * picks it up with no other change.
 */
export const DRIVER_WORKERS: Record<V4DriverKey, DriverWorker> = {
  // Block 4 — Development drivers whose data source already exists in V1.
  // They reuse the V1 HTTP clients but never their mock fallbacks: see
  // lib/v4/drivers/source.ts (requireLive).
  authority: authorityWorker,
  speed: speedWorker,
  accessibility: accessibilityWorker,
  compliance: complianceWorker,

  // Block 5 — rewritten or brand-new drivers.
  discoverability: discoverabilityWorker,
  awareness: awarenessWorker,
  schema: schemaWorker,
  content: contentWorker,
  // No automatic source by design: pauses on needs_decision for the operator
  // to type the J-Horizon score.
  ai_visibility: aiVisibilityWorker,
  // Implemented as an explicit, specific refusal — the SimilarWeb source the
  // spec mandates is not integrated and no equivalent measures the same thing.
  traffic: trafficWorker,
}

export function getWorker(driverKey: string): DriverWorker | undefined {
  return DRIVER_WORKERS[driverKey as V4DriverKey]
}
