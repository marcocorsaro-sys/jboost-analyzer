/**
 * Smoke test del use case Pre-Sales Domain Snapshot — orchestra TUTTI
 * i provider della Phase 7B (DataForSEO, Wappalyzer, Structured Data,
 * Indexability, CrUX, WHOIS) in parallelo e stampa il payload completo.
 *
 * Costo atteso: $0 se passi `--no-dataforseo` (skip AI Overview scan),
 * altrimenti ~$0.06 per 5 keyword di smoke.
 *
 * Usage:
 *   bash scripts/snapshot-smoke                   # default jakala.com con 0 keyword (DataForSEO skipped)
 *   DOMAIN=soloaffittipay.it bash scripts/snapshot-smoke
 *   DATAFORSEO_KEYWORDS="affitti monza,affitto milano" bash scripts/snapshot-smoke
 */

import { createClient } from '@supabase/supabase-js'
import { buildDomainSnapshot } from '../lib/integrations/use-cases/pre-sales/domain-snapshot'

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = SUPABASE_URL

  const domain = process.env.DOMAIN || 'jakala.com'
  const keywords = (process.env.DATAFORSEO_KEYWORDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  console.log(`=== Domain Snapshot smoke for ${domain} ===`)
  console.log(`DataForSEO keywords: ${keywords.length === 0 ? '(none, skipped)' : keywords.length}`)
  console.log()

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const snap = await buildDomainSnapshot({
    supabase,
    domain,
    country: 'Italy',
    language: 'it',
    keywords,
  })

  console.log(`elapsed: ${(snap.elapsedMs / 1000).toFixed(1)}s`)
  console.log(`Pre-sales score: ${snap.presalesScore !== null ? snap.presalesScore + '/100' : 'n/a'}`)
  console.log(`Provider errors: ${snap.errors.length}`)
  for (const e of snap.errors) console.log(`  [${e.provider}] ${e.message}`)
  console.log()

  // Per-provider summary
  if (snap.indexability) {
    console.log(`Indexability: score=${snap.indexability.score}/100 issues=${snap.indexability.issues.length}`)
  } else console.log('Indexability: n/a')

  if (snap.structuredData) {
    console.log(`Structured Data: coverage=${snap.structuredData.coverage.score}/100 types=${snap.structuredData.uniqueTypes.length}`)
  } else console.log('Structured Data: n/a')

  if (snap.crux) {
    if (snap.crux.available) {
      console.log(`CrUX: LCP=${snap.crux.lcpMs}ms INP=${snap.crux.inpMs}ms CLS=${snap.crux.clsValue} TTFB=${snap.crux.ttfbMs}ms score=${snap.crux.score}/100`)
    } else {
      console.log('CrUX: not enough Chrome traffic for this origin')
    }
  } else console.log('CrUX: n/a')

  if (snap.tech) {
    console.log(`MarTech: ${snap.tech.technologies.length} tech in ${Object.keys(snap.tech.byCategory).length} categories`)
  } else console.log('MarTech: n/a')

  if (snap.whois) {
    console.log(`WHOIS: age=${snap.whois.ageYears ?? '?'}y registrar=${snap.whois.registrar ?? '?'} expires_in=${snap.whois.daysToExpiry ?? '?'}d`)
  } else console.log('WHOIS: n/a')

  if (snap.ai) {
    console.log(`AI Visibility: ${snap.ai.successCount}/${snap.ai.totalKeywords} keyword ok, ${snap.ai.aiOverviewPercentage}% AI Overview, $${snap.ai.totalCostUsd.toFixed(4)} cost`)
  } else console.log('AI Visibility: skipped (no keywords)')

  console.log('\n✓ SMOKE TEST PASSED')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(2)
})
