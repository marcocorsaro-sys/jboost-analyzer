/**
 * V4 runner — dispatch.
 *
 * Each driver job needs its own invocation (that is the whole point of the
 * per-driver runner: 10 drivers × their own maxDuration budget instead of one
 * 1.703-line monolith racing a single timeout). On Vercel the only way to get
 * a fresh invocation is a new HTTP request, so dispatch = POST to the worker
 * route and do NOT await the body.
 *
 * The request is authenticated with a shared secret, not a user session: the
 * worker runs with the service role and must never be reachable from outside.
 */

const DISPATCH_PATH = '/api/v4/drivers/run'

export function runnerSecret(): string | undefined {
  return process.env.V4_RUNNER_SECRET ?? process.env.CRON_SECRET
}

/**
 * Absolute base URL of this deployment.
 *
 * Derived from the incoming request when we have one — that is the only value
 * guaranteed to be the host actually serving us (preview URL, custom domain,
 * localhost) — with the usual env fallbacks for callers with no request.
 */
export function resolveBaseUrl(request?: Request): string {
  if (request) {
    try {
      return new URL(request.url).origin
    } catch {
      /* fall through to env */
    }
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export interface DispatchResult {
  driverKey: string
  dispatched: boolean
  error?: string
}

/**
 * Fire one driver job. Resolves as soon as the worker route has ACCEPTED the
 * job, not when the job is finished — the caller must never block on the work.
 */
export async function dispatchDriverJob(
  baseUrl: string,
  analysisId: string,
  driverKey: string,
): Promise<DispatchResult> {
  const secret = runnerSecret()
  if (!secret) {
    return { driverKey, dispatched: false, error: 'V4_RUNNER_SECRET / CRON_SECRET not configured' }
  }

  try {
    const res = await fetch(`${baseUrl}${DISPATCH_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ analysisId, driverKey }),
      // Never let a slow worker hold up the fan-out: we only need the ack.
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok && res.status !== 202) {
      return { driverKey, dispatched: false, error: `worker route returned ${res.status}` }
    }
    return { driverKey, dispatched: true }
  } catch (err) {
    // A timeout here means the worker took the job but is still working on it
    // (it acks before running). Anything else is a real dispatch failure; the
    // row stays 'queued' either way and the reaper is the safety net.
    const message = err instanceof Error ? err.message : String(err)
    if (/timeout|aborted/i.test(message)) return { driverKey, dispatched: true }
    return { driverKey, dispatched: false, error: message }
  }
}

/** Fan out every queued driver of an analysis, in parallel. */
export async function dispatchAll(
  baseUrl: string,
  analysisId: string,
  driverKeys: string[],
): Promise<DispatchResult[]> {
  return Promise.all(driverKeys.map((k) => dispatchDriverJob(baseUrl, analysisId, k)))
}
