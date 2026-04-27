/**
 * Parity test: run the same analysis twice — once via the legacy edge
 * function `run-analysis` (Deno, deployed on Supabase) and once via the
 * new Next.js Node orchestrator (lib/analyses/run-analysis.ts) — and
 * diff the resulting 9 driver scores side-by-side.
 *
 * Goal: validate that the Phase 7 port preserves behavior before flipping
 * the USE_NEXT_RUN_ANALYSIS flag in production.
 *
 * Usage:
 *   npx tsx scripts/parity-run-analysis.ts \
 *     --client=<uuid> \
 *     --domain=<example.com> \
 *     [--country=us] \
 *     [--competitor=<d1>] [--competitor=<d2>] ... \
 *     [--topic=<topic>] \
 *     [--poll-timeout=300]   # seconds, default 300
 *
 * Required env (loaded from .env.local automatically by tsx if you wire it,
 * otherwise export manually before running):
 *   NEXT_PUBLIC_SUPABASE_URL  (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 * Plus the same provider keys you use in production, otherwise both paths
 * fall back to deterministic mock data and the diff is 0 by construction
 * (acceptable for smoke testing the plumbing, but does not validate API
 * fetch logic):
 *   SEMRUSH_API_KEY, AHREFS_API_KEY, GOOGLE_PSI_API_KEY,
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, PPLX_API_KEY
 *
 * Exit codes:
 *   0 — both runs completed and all drivers within tolerance
 *   1 — drivers diverged beyond tolerance (|Δ|>5 on any driver)
 *   2 — bad input or env / one of the runs failed/timed out
 */

import { createClient } from '@supabase/supabase-js'
import { runAnalysis } from '../lib/analyses/run-analysis'

interface CliArgs {
  client: string
  domain: string
  country: string
  competitors: string[]
  topic: string
  pollTimeoutSec: number
}

function parseArgs(): CliArgs {
  const map: Record<string, string> = {}
  const competitors: string[] = []
  for (const raw of process.argv.slice(2)) {
    const m = raw.match(/^--([^=]+)=(.*)$/)
    if (!m) continue
    if (m[1] === 'competitor') competitors.push(m[2])
    else map[m[1]] = m[2]
  }
  if (!map.client || !map.domain) {
    console.error(
      'Usage: npx tsx scripts/parity-run-analysis.ts \\\n' +
        '  --client=<uuid> --domain=<example.com> \\\n' +
        '  [--country=us] [--competitor=<d>] ... [--topic=<t>] [--poll-timeout=300]',
    )
    process.exit(2)
  }
  return {
    client: map.client,
    domain: map.domain,
    country: map.country || 'us',
    competitors,
    topic: map.topic || '',
    pollTimeoutSec: Number(map['poll-timeout']) || 300,
  }
}

function envOrDie(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n]
    if (v) return v
  }
  console.error(`Missing required env var (any of: ${names.join(', ')})`)
  process.exit(2)
}

async function readDriverResults(
  supabase: ReturnType<typeof createClient>,
  analysisId: string,
): Promise<Record<string, { score: number | null; status: string }>> {
  const { data } = await supabase
    .from('driver_results')
    .select('driver_name, score, status')
    .eq('analysis_id', analysisId)
  const map: Record<string, { score: number | null; status: string }> = {}
  for (const r of (data ?? []) as Array<{ driver_name: string; score: number | null; status: string }>) {
    map[r.driver_name] = { score: r.score, status: r.status }
  }
  return map
}

async function waitForCompletion(
  supabase: ReturnType<typeof createClient>,
  analysisId: string,
  label: string,
  timeoutMs: number,
): Promise<{ status: string; overall: number | null; phase: string | null }> {
  const start = Date.now()
  let lastPhase = ''
  while (Date.now() - start < timeoutMs) {
    const { data } = await supabase
      .from('analyses')
      .select('status, current_phase, overall_score')
      .eq('id', analysisId)
      .single<{ status: string; current_phase: string | null; overall_score: number | null }>()
    if (data?.status === 'completed' || data?.status === 'failed') {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      console.log(
        `[${label}] ${data.status} after ${elapsed}s (overall=${data.overall_score ?? '—'}, last_phase=${data.current_phase ?? '—'})`,
      )
      return { status: data.status, overall: data.overall_score, phase: data.current_phase }
    }
    if (data?.current_phase && data.current_phase !== lastPhase) {
      console.log(`[${label}] phase → ${data.current_phase}`)
      lastPhase = data.current_phase
    }
    await new Promise((r) => setTimeout(r, 5_000))
  }
  console.error(`[${label}] timeout after ${timeoutMs / 1000}s`)
  return { status: 'timeout', overall: null, phase: null }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}

async function main() {
  const args = parseArgs()
  const SUPABASE_URL = envOrDie('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')
  const SERVICE_KEY = envOrDie('SUPABASE_SERVICE_ROLE_KEY')

  // The new orchestrator reads SUPABASE_URL directly (not NEXT_PUBLIC) when
  // it builds its own service-role client. Make sure it's set so the
  // in-process call succeeds without env leakage.
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = SUPABASE_URL

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // 1. Resolve user_id from a client member with role=owner (analyses.user_id is NOT NULL).
  const { data: members } = await supabase
    .from('client_members')
    .select('user_id, role')
    .eq('client_id', args.client)
    .eq('role', 'owner')
    .limit(1)
  const memberRow = (members ?? [])[0] as { user_id: string; role: string } | undefined
  if (!memberRow?.user_id) {
    console.error(`No client_members.role='owner' found for client_id=${args.client}.`)
    process.exit(2)
  }
  const userId = memberRow.user_id

  // Quick provider-key visibility check
  const apiKeysSet = ['SEMRUSH_API_KEY', 'AHREFS_API_KEY', 'GOOGLE_PSI_API_KEY']
    .filter((k) => !!process.env[k])
  if (apiKeysSet.length === 0) {
    console.warn(
      '\n⚠  No SEO API keys in env — both paths will fall back to deterministic mocks. The diff will be 0 by construction. To validate API plumbing, export SEMRUSH_API_KEY/AHREFS_API_KEY/GOOGLE_PSI_API_KEY first.\n',
    )
  } else {
    console.log(`API keys present: ${apiKeysSet.join(', ')}`)
  }

  console.log(
    `\nParity run: domain=${args.domain} country=${args.country} competitors=[${args.competitors.join(', ') || '—'}]`,
  )
  console.log(`Tied to client_id=${args.client} user_id=${userId}\n`)

  // 2. Insert two identical analyses rows
  const baseRow = {
    user_id: userId,
    client_id: args.client,
    domain: args.domain,
    country: args.country,
    language: 'en',
    target_topic: args.topic || null,
    competitors: args.competitors,
    status: 'running' as const,
    started_at: new Date().toISOString(),
    source: 'manual' as const,
  }

  const { data: oldRow, error: e1 } = await supabase
    .from('analyses')
    .insert(baseRow)
    .select()
    .single<{ id: string }>()
  const { data: newRow, error: e2 } = await supabase
    .from('analyses')
    .insert(baseRow)
    .select()
    .single<{ id: string }>()
  if (e1 || e2 || !oldRow || !newRow) {
    console.error('Failed to insert analyses rows:', e1 || e2)
    process.exit(2)
  }
  console.log(`old.id=${oldRow.id}  (legacy edge function)`)
  console.log(`new.id=${newRow.id}  (new in-process orchestrator)\n`)

  // 3. Trigger both
  const t0 = Date.now()
  const oldInvoke = supabase.functions
    .invoke('run-analysis', { body: { analysisId: oldRow.id } })
    .catch((err) => {
      console.error('[OLD] edge function invoke threw:', err)
    })
  const newInvoke = runAnalysis(newRow.id).catch((err) => {
    console.error('[NEW] runAnalysis threw:', err)
  })

  // 4. Poll both in parallel
  const timeoutMs = args.pollTimeoutSec * 1_000
  const [resultOld, resultNew] = await Promise.all([
    waitForCompletion(supabase, oldRow.id, 'OLD', timeoutMs),
    waitForCompletion(supabase, newRow.id, 'NEW', timeoutMs),
  ])

  await Promise.allSettled([oldInvoke, newInvoke])

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n→ both runs reached terminal state in ${totalSec}s.`)

  if (resultOld.status !== 'completed' || resultNew.status !== 'completed') {
    console.error(`\n✗ At least one run did NOT complete: OLD=${resultOld.status} NEW=${resultNew.status}`)
    console.error(`  Inspect rows: SELECT * FROM analyses WHERE id IN ('${oldRow.id}','${newRow.id}');`)
    process.exit(2)
  }

  // 5. Diff driver results
  const oldDrivers = await readDriverResults(supabase, oldRow.id)
  const newDrivers = await readDriverResults(supabase, newRow.id)
  const all = new Set([...Object.keys(oldDrivers), ...Object.keys(newDrivers)])

  console.log('\n=== DRIVER PARITY ===')
  console.log(
    `${pad('driver', 18)}| ${pad('old', 5)}| ${pad('new', 5)}| ${pad('Δ', 5)}| status`,
  )
  console.log('------------------+------+------+------+----------------------')

  let totalAbsDelta = 0
  let outOfTolerance = 0
  const TOL = 5

  const driverOrder = [...all].sort()
  for (const name of driverOrder) {
    const o = oldDrivers[name]
    const n = newDrivers[name]
    const oScore = o?.score ?? null
    const nScore = n?.score ?? null
    const delta = oScore != null && nScore != null ? nScore - oScore : null
    if (delta !== null) {
      totalAbsDelta += Math.abs(delta)
      if (Math.abs(delta) > TOL) outOfTolerance++
    }
    const oStr = oScore == null ? '—' : String(oScore)
    const nStr = nScore == null ? '—' : String(nScore)
    const dStr = delta == null ? '—' : (delta >= 0 ? '+' : '') + String(delta)
    const statusMatch =
      o?.status === n?.status ? `${o?.status ?? '—'} ✓` : `${o?.status ?? '—'} vs ${n?.status ?? '—'} ✗`
    console.log(`${pad(name, 18)}| ${pad(oStr, 5)}| ${pad(nStr, 5)}| ${pad(dStr, 5)}| ${statusMatch}`)
  }

  // Overall + summary
  const oldOverall = resultOld.overall ?? '—'
  const newOverall = resultNew.overall ?? '—'
  const overallDelta =
    typeof resultOld.overall === 'number' && typeof resultNew.overall === 'number'
      ? resultNew.overall - resultOld.overall
      : null
  console.log('------------------+------+------+------+----------------------')
  console.log(
    `${pad('OVERALL', 18)}| ${pad(String(oldOverall), 5)}| ${pad(String(newOverall), 5)}| ${pad(
      overallDelta == null ? '—' : (overallDelta >= 0 ? '+' : '') + String(overallDelta),
      5,
    )}|`,
  )

  console.log(`\nTotal |Δ| sum: ${totalAbsDelta}`)
  console.log(`Drivers with |Δ| > ${TOL}: ${outOfTolerance}`)
  if (outOfTolerance === 0) {
    console.log('\n✓ Parity check PASSED — all drivers within tolerance.')
    process.exit(0)
  }
  console.log(
    `\n✗ Parity check FAILED — ${outOfTolerance} driver(s) drifted more than ±${TOL}. Investigate before flipping USE_NEXT_RUN_ANALYSIS=true in production.`,
  )
  process.exit(1)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(2)
})
