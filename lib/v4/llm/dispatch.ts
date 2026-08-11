/**
 * V4 insights — continuation dispatch.
 *
 * The insights run needs its own invocation chain for the same reason the
 * driver runner does (lib/v4/runner/dispatch.ts): up to 9+1 sequential LLM
 * calls do not fit one Vercel invocation, and on Vercel a fresh invocation
 * is a new HTTP request. Same shared-secret authentication, same "resolve on
 * ack, never on completion" contract; a timeout means the route took the job
 * and is still working, which is success for a dispatcher.
 */

import { runnerSecret } from '@/lib/v4/runner/dispatch'

const INSIGHTS_RUN_PATH = '/api/v4/insights/run'

export interface InsightsDispatchResult {
  dispatched: boolean
  error?: string
}

export async function dispatchInsightsJob(
  baseUrl: string,
  analysisId: string,
): Promise<InsightsDispatchResult> {
  const secret = runnerSecret()
  if (!secret) {
    return { dispatched: false, error: 'V4_RUNNER_SECRET / CRON_SECRET not configured' }
  }

  try {
    const res = await fetch(`${baseUrl}${INSIGHTS_RUN_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ analysisId }),
      // Only the ack matters: the run itself may take minutes.
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok && res.status !== 202) {
      return { dispatched: false, error: `insights route returned ${res.status}` }
    }
    return { dispatched: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/timeout|aborted/i.test(message)) return { dispatched: true }
    return { dispatched: false, error: message }
  }
}
