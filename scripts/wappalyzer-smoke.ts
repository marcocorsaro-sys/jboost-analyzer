/**
 * Wappalyzer smoke test — fa detection del MarTech stack di un dominio
 * pubblico e stampa la lista delle tecnologie rilevate.
 *
 * Costo: $0 (solo HTTP fetch, niente API esterna).
 *
 * Usage:
 *   bash scripts/wappalyzer-smoke              # default: jakala.com
 *   DOMAIN=soloaffittipay.it bash scripts/wappalyzer-smoke
 */

import { createClient } from '@supabase/supabase-js'
import { detectTechStack } from '../lib/integrations/providers/wappalyzer'

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = SUPABASE_URL

  const domain = process.env.DOMAIN || 'jakala.com'

  console.log('=== Wappalyzer smoke test ===')
  console.log(`Domain: ${domain}\n`)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const t0 = Date.now()
  const result = await detectTechStack({ supabase, domain })
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  console.log(`Elapsed: ${elapsed}s`)
  console.log(`HTTP status: ${result.status}`)
  console.log(`Final URL: ${result.finalUrl ?? '—'}`)
  if (!result.ok) {
    console.error(`✗ Fetch failed: ${result.error}`)
    process.exit(1)
  }
  console.log(`Total technologies detected: ${result.technologies.length}\n`)

  if (result.technologies.length === 0) {
    console.log('No technologies matched. The fingerprints may not cover this stack yet.')
    process.exit(0)
  }

  console.log('=== TECHNOLOGIES BY CATEGORY ===')
  const byCategory = new Map<string, typeof result.technologies>()
  for (const t of result.technologies) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, [])
    byCategory.get(t.category)!.push(t)
  }
  for (const [cat, techs] of byCategory) {
    console.log(`\n[${cat}]  (${techs.length})`)
    for (const t of techs) {
      const ver = t.version ? ` v${t.version}` : ''
      const via = `via:${t.matchedVia.join('+')}`
      console.log(`  ${t.name}${ver}  conf=${t.confidence}  ${via}`)
    }
  }

  console.log('\n✓ SMOKE TEST PASSED')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(2)
})
