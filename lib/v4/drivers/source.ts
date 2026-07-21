/**
 * V4 driver sources — the no-fallback rule, enforced in one place.
 *
 * The V4 spec is explicit: ONE source per driver, NO fallback, and on a source
 * failure the driver blocks with an alert (README 01, sources table). This is
 * not a style preference — it is the fix for the concrete V1 bug where Ariston
 * scored 0/100 on Schema because a detection failure was written to the DB as
 * a real measurement.
 *
 * The V1 clients in lib/seo-apis/* do the opposite by design: they swallow
 * every error and return a plausible-looking mock (DR=50, PSI 0/0, empty site
 * health) tagged with `_meta.is_mock`. Reusing their HTTP plumbing is fine —
 * that is the whole point of block 4 — but a mock must NEVER reach a score.
 *
 * `requireLive` is the seam that makes that impossible to forget.
 */

import type { ApiResponse } from '@/lib/seo-apis/types'

/** A source could not produce a real measurement. Blocks the driver. */
export class DriverSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DriverSourceError'
  }
}

/**
 * Unwrap a V1 ApiResponse, refusing anything the provider did not really
 * measure. A mock is a failure that happens to have a number in it.
 */
export function requireLive<T>(res: ApiResponse<T>, what: string): T {
  if (res._meta?.is_mock) {
    const detail = res._meta.error ? `: ${res._meta.error}` : ''
    throw new DriverSourceError(
      `${what} — ${res._meta.source} returned no live data${detail}. ` +
        'The V4 spec forbids substituting a fallback value, so the driver is blocked.',
    )
  }
  return res.data
}

/** Stop before the invocation is killed, so the outcome can still be written. */
export function assertDeadline(deadlineAt: number, what: string): void {
  if (Date.now() >= deadlineAt) {
    throw new DriverSourceError(
      `${what} — deadline reached before the measurement completed. ` +
        'Nothing partial was scored; the job will be retried.',
    )
  }
}

/**
 * Run tasks with a concurrency cap.
 *
 * A driver measures up to 5 sites × N pages × 2 strategies; firing all of them
 * at once gets us rate-limited, and running them serially blows the deadline.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function runner(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
  return results
}

/** Arithmetic mean, or null when there is nothing real to average. */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Round to `digits` decimals without the float noise of toFixed round-trips. */
export function round(value: number, digits = 1): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}
