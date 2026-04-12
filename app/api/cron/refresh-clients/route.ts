import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { runMonitoringForClient } from '@/lib/monitoring/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel Hobby allows up to 60s for serverless funcs

const MAX_CLIENTS_PER_RUN = 50

/**
 * GET /api/cron/refresh-clients
 *
 * Vercel Cron orchestrator (Phase 4C). Default schedule in vercel.json runs
 * once a day at 04:00 UTC. The schedule frequency is intentionally minimal
 * (compatible with Vercel Hobby's daily-only limit); the per-client cadence
 * is enforced by next_run_at on each subscription row, so 'weekly' clients
 * are still picked up only every 7 days.
 *
 * Authentication: Vercel injects `Authorization: Bearer ${CRON_SECRET}` for
 * cron jobs when the env var is set. We refuse the request otherwise.
 *
 * Algorithm:
 *   1. Use the service role client (cron has no user session, must bypass RLS).
 *   2. Query active subscriptions with next_run_at <= now() and not paused
 *      until a future date. Order by next_run_at to make sure the most
 *      overdue clients run first.
 *   3. For each (max MAX_CLIENTS_PER_RUN), call runMonitoringForClient which:
 *      - inserts an analyses row tagged source='monitoring'
 *      - fires the run-analysis edge function (async)
 *      - bumps last_run_at + next_run_at
 *   4. Return a summary { picked, started, errors }.
 */
export async function GET(request: Request) {
  // 1. Authn — Vercel Cron Bearer secret.
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') || ''
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Service role client (bypasses RLS for orchestration).
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json(
      { error: 'Service role / supabase URL not configured' },
      { status: 500 }
    )
  }
  const supabase = createAdminClient(supabaseUrl, serviceRoleKey)

  // 3. Pick the clients that are due. We also accept rows where next_run_at
  // is NULL (never been run), so newly promoted clients get their first scan.
  const nowIso = new Date().toISOString()
  const { data: dueSubs, error: dueError } = await supabase
    .from('client_update_subscriptions')
    .select('client_id, next_run_at, paused_until, frequency, frequency_days')
    .eq('is_active', true)
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
    .order('next_run_at', { ascending: true, nullsFirst: true })
    .limit(MAX_CLIENTS_PER_RUN)

  if (dueError) {
    return NextResponse.json({ error: dueError.message }, { status: 500 })
  }

  // 4. Filter out subscriptions still inside their paused_until window.
  const eligible = (dueSubs ?? []).filter(s => {
    if (!s.paused_until) return true
    return new Date(s.paused_until).getTime() <= Date.now()
  })

  // 5. Process serially with a small concurrency cap to avoid stampeding the
  // edge function. Concurrency 3 keeps total runtime well under maxDuration
  // even with the slowest cold-start path.
  const concurrency = 3
  let started = 0
  const errors: { clientId: string; error: string }[] = []

  async function worker(items: typeof eligible) {
    for (const sub of items) {
      const result = await runMonitoringForClient(supabase, sub.client_id)
      if (result.error) {
        errors.push({ clientId: sub.client_id, error: result.error })
      } else {
        started += 1
      }
    }
  }

  // Split eligible into N round-robin chunks for the workers.
  const buckets: (typeof eligible)[] = Array.from({ length: concurrency }, () => [])
  eligible.forEach((sub, i) => buckets[i % concurrency].push(sub))
  await Promise.all(buckets.map(worker))

  return NextResponse.json({
    picked: eligible.length,
    started,
    errors,
    timestamp: nowIso,
  })
}
