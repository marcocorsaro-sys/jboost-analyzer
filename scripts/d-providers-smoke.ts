/**
 * Smoke test combinato per i due provider della Phase 7B-D:
 *   - Structured Data Audit (auditStructuredData)
 *   - Indexability Sanity (auditIndexability)
 *
 * Costo: $0 (solo HTTP fetch). Tempo atteso: 5-15 secondi.
 *
 * Usage:
 *   bash scripts/d-providers-smoke
 *   DOMAIN=soloaffittipay.it bash scripts/d-providers-smoke
 */

import { createClient } from '@supabase/supabase-js'
import { auditStructuredData } from '../lib/integrations/providers/structured-data'
import { auditIndexability } from '../lib/integrations/providers/indexability'

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = SUPABASE_URL

  const domain = process.env.DOMAIN || 'jakala.com'
  const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  console.log(`=== Phase 7B-D smoke test on ${domain} ===\n`)

  // ----- Indexability -----
  console.log('--- Indexability Audit ---')
  const tIdx = Date.now()
  const idx = await auditIndexability({ supabase, domain })
  const idxElapsed = ((Date.now() - tIdx) / 1000).toFixed(1)
  console.log(`elapsed: ${idxElapsed}s`)
  console.log(`final URL: ${idx.finalUrl ?? '—'}`)
  console.log(`score: ${idx.score}/100`)
  console.log(`robots.txt found: ${idx.robots.found}, blocks all: ${idx.robots.blocksAllCrawl}, sitemaps declared: ${idx.robots.sitemaps.length}`)
  if (idx.sitemap) {
    console.log(`sitemap (${idx.sitemapUrlUsed}): kind=${idx.sitemap.kind} urls=${idx.sitemap.urlCount}`)
  } else {
    console.log('sitemap: not found')
  }
  if (idx.homepage) {
    console.log(`homepage: noindex=${idx.homepage.isNoindex} canonical=${idx.homepage.canonical ? 'yes' : 'no'} hreflang=${idx.homepage.hreflangCount}`)
  }
  if (idx.issues.length > 0) {
    console.log(`issues (${idx.issues.length}):`)
    for (const issue of idx.issues) {
      console.log(`  [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`)
    }
  } else {
    console.log('issues: none')
  }

  // ----- Structured Data -----
  console.log('\n--- Structured Data Audit ---')
  // Per il smoke usiamo solo la homepage. In production estenderemo a top-pages.
  const urls = [baseUrl]
  const tSd = Date.now()
  const sd = await auditStructuredData({ supabase, urls })
  const sdElapsed = ((Date.now() - tSd) / 1000).toFixed(1)
  console.log(`elapsed: ${sdElapsed}s`)
  console.log(`pages scanned: ${sd.pages.length}`)
  console.log(`pages with schema: ${sd.pagesWithSchema}`)
  console.log(`total JSON-LD blocks: ${sd.totalBlocks}, parse errors: ${sd.totalParseErrors}`)
  console.log(`coverage score: ${sd.coverage.score}/100`)
  console.log(`unique types: ${sd.uniqueTypes.length === 0 ? '(none)' : sd.uniqueTypes.join(', ')}`)
  if (sd.coverage.missingHighValueTypes.length > 0) {
    console.log(`missing high-value types: ${sd.coverage.missingHighValueTypes.join(', ')}`)
  }

  console.log('\n✓ SMOKE TEST PASSED')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(2)
})
