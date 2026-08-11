/**
 * V4 runner — driver worker registry.
 *
 * This is the seam the whole Block 2 exists to create: the runner knows how to
 * queue, claim, lease, retry, normalize and reap a driver job, and it reaches
 * the actual measurement through exactly one function per driver.
 *
 * All ten keys resolve to a real worker (blocks 4 and 5). One is deliberately
 * not an automatic measurement: ai_visibility pauses on needs_decision with a
 * copy-prompt — the paste-driven J-Horizon flow (Bibbia sheets 3/7), where the
 * operator pastes the chatbot answer back and one LLM call extracts the GEO
 * scores. A pause that SAYS what is missing, never a placeholder number — a
 * mock would be the exact V1 bug the V4 spec calls out by name (Ariston
 * scoring 0/100 on Schema because a detection failure was written as a real
 * measurement).
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
  // No automatic source by design: pauses on needs_decision with the
  // J-Horizon copy-prompt, then extracts the pasted answer via one LLM call.
  ai_visibility: aiVisibilityWorker,
  // Similarweb total visits, mean of the last 3 available months. Below-
  // coverage competitors alert instead of blocking (sheet 17).
  traffic: trafficWorker,
}

export function getWorker(driverKey: string): DriverWorker | undefined {
  return DRIVER_WORKERS[driverKey as V4DriverKey]
}
