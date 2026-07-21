/**
 * V4 runner — driver worker registry.
 *
 * This is the seam the whole Block 2 exists to create: the runner knows how to
 * queue, claim, lease, retry, normalize and reap a driver job, and it reaches
 * the actual measurement through exactly one function per driver.
 *
 * The workers themselves are NOT Block 2. Per the reuse map §7, the drivers
 * land in blocks 4 (Authority, Speed, Accessibility, Compliance — sources
 * already present in V1) and 5 (Discoverability, Awareness, Schema, Content,
 * Traffic, AI Visibility — rewritten or new). Until then every key resolves to
 * `notImplemented`, which fails the job LOUDLY with an explicit message.
 *
 * That is deliberate. A placeholder returning raw 0 or a mock number would be
 * the exact V1 bug the V4 spec calls out by name — Ariston scoring 0/100 on
 * Schema because a detection failure was written as a real measurement. A
 * driver that cannot measure must say so, never quietly produce a number.
 */

import type { V4DriverKey } from '@/lib/scoring/registry'
import type { DriverWorker } from './types'
import { authorityWorker } from '@/lib/v4/drivers/authority'
import { speedWorker } from '@/lib/v4/drivers/speed'
import { accessibilityWorker } from '@/lib/v4/drivers/accessibility'
import { complianceWorker } from '@/lib/v4/drivers/compliance'

function notImplemented(driverKey: V4DriverKey, block: number): DriverWorker {
  return async () => ({
    status: 'error',
    error: `driver "${driverKey}" has no V4 worker yet (scheduled for block ${block} of the reuse map)`,
  })
}

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
  discoverability: notImplemented('discoverability', 5),
  awareness: notImplemented('awareness', 5),
  schema: notImplemented('schema', 5),
  content: notImplemented('content', 5),
  traffic: notImplemented('traffic', 5),
  ai_visibility: notImplemented('ai_visibility', 5),
}

export function getWorker(driverKey: string): DriverWorker | undefined {
  return DRIVER_WORKERS[driverKey as V4DriverKey]
}
