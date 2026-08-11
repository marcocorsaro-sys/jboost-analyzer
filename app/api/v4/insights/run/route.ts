export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Vercel Pro; the engine's budget stays well under it.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateInsights } from '@/lib/v4/llm/orchestrator'
import { dispatchInsightsJob } from '@/lib/v4/llm/dispatch'
import { runnerSecret, resolveBaseUrl } from '@/lib/v4/runner/dispatch'

const Body = z.object({
  analysisId: z.string().uuid(),
})

/**
 * POST /api/v4/insights/run — the V4 insights worker invocation.
 *
 * INTERNAL ONLY, same contract as /api/v4/drivers/run: service role, no user
 * session, gated by the shared runner secret. Callers: the user-facing
 * insights route's kick-off and THIS ROUTE ITSELF — the engine is
 * incremental, and when its time budget runs out with drivers left it
 * returns { next: true } and we re-dispatch a fresh invocation. The chain
 * terminates because every hop either persists at least one new insight (or
 * the summary) or ends in a terminal status; idempotent skipping of stored
 * insights makes a duplicate request harmless.
 */
export async function POST(request: Request) {
  const secret = runnerSecret()
  const authHeader = request.headers.get('authorization') ?? ''

  if (!secret) {
    // Never leave a service-role endpoint open in production because an env
    // var is missing. Local dev without a secret is allowed on purpose.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'runner secret not configured' }, { status: 500 })
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

  // Budget: leave headroom for the last in-flight LLM call + writeback before
  // Vercel kills the invocation.
  const result = await generateInsights(db, parsed.analysisId, {
    budgetMs: (maxDuration - 60) * 1000,
  })

  // Continuation: still work to do -> hand it to a fresh invocation.
  let continuation: { dispatched: boolean; error?: string } | null = null
  if (result.next) {
    continuation = await dispatchInsightsJob(resolveBaseUrl(request), parsed.analysisId)
    if (!continuation.dispatched) {
      // A broken chain must be visible, not a silently stuck 'running'.
      await db
        .from('analyses')
        .update({
          v4_insights_status: 'error',
          v4_insights_error: `continuazione insight non dispatchata: ${continuation.error ?? 'unknown'}`,
        })
        .eq('id', parsed.analysisId)
    }
  }

  console.log(
    `[v4/insights/run] analysis=${parsed.analysisId} status=${result.status} ` +
      `processed=${result.processed.length} skipped=${result.skippedExisting.length} ` +
      `failed=${result.failed.length} next=${result.next} ms=${Date.now() - startedAt}`,
  )

  return NextResponse.json({ ...result, continuation }, { status: 200 })
}
