/**
 * DataForSEO smoke test — chiama il provider su 5 keyword reali di
 * soloaffittipay.it, mercato Italia, e stampa un summary completo
 * della risposta + verifica logging in integration_call_log.
 *
 * Usage:
 *   bash scripts/dataforseo-smoke
 *
 * Pre-req:
 *   .env.local contiene NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD.
 *
 * Costo atteso: 5 × $0.0006 = $0.003.
 */

import { createClient } from '@supabase/supabase-js'
import { scanAIOverviewVisibility } from '../lib/integrations/providers/dataforseo'

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const DFS_LOGIN = process.env.DATAFORSEO_LOGIN
  const DFS_PASSWORD = process.env.DATAFORSEO_PASSWORD

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }
  if (!DFS_LOGIN || !DFS_PASSWORD) {
    console.error('Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD')
    process.exit(2)
  }
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = SUPABASE_URL

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // 5 keyword realistic per soloaffittipay.it
  const keywords = [
    'affitti monza',
    'affitto appartamento monza',
    'affitti brevi milano',
    'case in affitto milano centro',
    'monolocale in affitto monza',
  ]

  console.log('=== DataForSEO smoke test ===')
  console.log(`Login: ${DFS_LOGIN}`)
  console.log(`Keywords: ${keywords.length}`)
  console.log(`Location: Italy`)
  console.log(`Client domain: soloaffittipay.it`)
  console.log(`Estimated cost: ~$${(keywords.length * 0.0006).toFixed(4)}\n`)

  const t0 = Date.now()

  const summary = await scanAIOverviewVisibility({
    supabase,
    keywords,
    location: 'Italy',
    language: 'it',
    clientDomain: 'soloaffittipay.it',
    concurrency: 5,
  })

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  console.log('=== SUMMARY ===')
  console.log(`Elapsed: ${elapsed}s`)
  console.log(`Total keywords: ${summary.totalKeywords}`)
  console.log(`Successful: ${summary.successCount}`)
  console.log(`Errors: ${summary.errorCount}`)
  console.log(`AI Overview present: ${summary.aiOverviewCount} (${summary.aiOverviewPercentage}%)`)
  console.log(`Featured Snippet present: ${summary.featuredSnippetCount}`)
  console.log(`People Also Ask present: ${summary.peopleAlsoAskCount}`)
  console.log(`Rich SERP overall: ${summary.richSerpPercentage}%`)
  console.log(`Client in top 10: ${summary.clientTop10Count} keyword(s)`)
  console.log(`Total cost: $${summary.totalCostUsd.toFixed(4)}\n`)

  console.log('=== PER KEYWORD ===')
  for (const r of summary.perKeyword) {
    const features = []
    if (r.hasAIOverview) features.push('AIO')
    if (r.hasFeaturedSnippet) features.push('FS')
    if (r.hasPeopleAlsoAsk) features.push('PAA')
    const featStr = features.length ? `[${features.join(',')}]` : '[—]'
    const posStr = r.clientPosition !== null ? `pos #${r.clientPosition}` : 'not in top 100'
    console.log(`  ${featStr.padEnd(12)} ${posStr.padEnd(20)} "${r.keyword}"`)
    if (r.hasAIOverview && r.topOrganic.length > 0) {
      console.log(`    top organic: ${r.topOrganic[0].domain} (#${r.topOrganic[0].rank})`)
    }
  }

  console.log('\n=== Verifica integration_call_log ===')
  // Le scritture su integration_call_log sono fire-and-forget (`.catch(...)`)
  // dal BaseProviderClient, quindi possono arrivare in DB qualche centinaio
  // di ms dopo la conclusione della call principale. Aspettiamo 1.5s prima
  // della SELECT per evitare false negative (mancavano log entries che però
  // erano in flight).
  await new Promise(r => setTimeout(r, 1500))
  const { data: logs, error: logErr } = await supabase
    .from('integration_call_log')
    .select('endpoint, http_status, latency_ms, cost_usd, attempt, error')
    .eq('provider', 'dataforseo')
    .gte('started_at', new Date(t0 - 5000).toISOString())
    .order('started_at', { ascending: false })
    .limit(10)

  if (logErr) {
    console.error('Failed to read integration_call_log:', logErr.message)
  } else if (!logs || logs.length === 0) {
    console.warn('NO log entries found — observability path NOT working.')
  } else {
    console.log(`Found ${logs.length} log entries:`)
    for (const log of logs as Array<Record<string, unknown>>) {
      console.log(
        `  [${log.endpoint}] status=${log.http_status} latency=${log.latency_ms}ms cost=$${log.cost_usd ?? '—'} attempt=${log.attempt} ${log.error ? 'ERR:' + log.error : 'OK'}`,
      )
    }
  }

  if (summary.errorCount === 0 && summary.successCount === keywords.length) {
    console.log('\n✓ SMOKE TEST PASSED')
    process.exit(0)
  }
  console.log('\n✗ SMOKE TEST had issues — see above')
  process.exit(1)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(2)
})
