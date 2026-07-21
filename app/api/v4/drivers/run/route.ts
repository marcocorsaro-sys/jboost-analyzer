export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Vercel Pro. Must stay under DEFAULT_LEASE_SECS (330).

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { executeDriverJob, DEFAULT_LEASE_SECS } from '@/lib/v4/runner/execute'
import { runnerSecret } from '@/lib/v4/runner/dispatch'

const Body = z.object({
  analysisId: z.string().uuid(),
  driverKey: z.string().min(1),
})

/**
 * POST /api/v4/drivers/run — the V4 worker invocation.
 *
 * INTERNAL ONLY. Runs with the service role and no user session, so it is
 * gated by a shared secret (V4_RUNNER_SECRET, falling back to CRON_SECRET)
 * rather than by RLS. Callers: the start route's fan-out and the cron reaper.
 *
 * One request = one driver job. The atomic claim inside executeDriverJob is
 * what makes a duplicate request harmless: the second one claims nothing.
 *
 * The response is deliberately awaited (not fire-and-forget): the caller uses
 * a short timeout and treats a timeout as "accepted", so a long-running driver
 * still gets its full maxDuration here.
 */
export async function POST(request: Request) {
  const secret = runnerSecret()
  const authHeader = request.headers.get('authorization') ?? ''

  if (!secret) {
    // Never leave a service-role endpoint open in production because an env
    // var is missing. Local dev without a secret is allowed on purpose.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'runner secret not configured' },
        { status: 500 },
      )
    }
  } else if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let parsed: z.infer<typeof Body>
  try {
    parsed = Body.parse(await request.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  const startedAt = Date.now()
  const db = createAdminClient()

  const result = await executeDriverJob(db, parsed.analysisId, parsed.driverKey, {
    leaseSecs: DEFAULT_LEASE_SECS,
    // Cooperative deadline: the worker should give up before Vercel kills us,
    // so the outcome still gets written.
    deadlineAt: startedAt + (maxDuration - 20) * 1000,
  })

  console.log(
    `[v4/drivers/run] analysis=${parsed.analysisId} driver=${parsed.driverKey} ` +
      `claimed=${result.claimed} status=${result.status ?? '-'} ms=${Date.now() - startedAt}`,
  )

  // A job we could not claim is not an error: another invocation owns it.
  return NextResponse.json({ ...result, driverKey: parsed.driverKey }, { status: 200 })
}
