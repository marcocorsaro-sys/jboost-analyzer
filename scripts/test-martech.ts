import { fetchSiteSignals, classifyWithAI, detectMartechStack } from '../lib/martech/detect'

async function main() {
  const domain = process.argv[2] || 'benetton.com'

  console.log(`\n=== Testing MarTech Detection for ${domain} ===\n`)

  // Step 1: Test fetchSiteSignals
  console.log('[Step 1] Fetching site signals...')
  try {
    const signals = await fetchSiteSignals(domain)
    console.log(`  ✓ Scripts: ${signals.scripts.length}`)
    console.log(`  ✓ Links: ${signals.links.length}`)
    console.log(`  ✓ Metas: ${signals.metas.length}`)
    console.log(`  ✓ Headers: ${Object.keys(signals.headers).join(', ')}`)
    console.log(`  ✓ Raw snippet length: ${signals.rawSnippet.length}`)
    console.log(`  Sample scripts:`, signals.scripts.slice(0, 3))

    // Step 2: Test AI classification
    if (process.env.ANTHROPIC_API_KEY) {
      console.log('\n[Step 2] AI Classification...')
      try {
        const { tools, usage } = await classifyWithAI(domain, signals)
        console.log(`  ✓ Detected ${tools.length} tools (${usage.input_tokens} in / ${usage.output_tokens} out tokens):`)
        tools.forEach(t => {
          console.log(`    - ${t.tool_name} (${t.category}) confidence: ${t.confidence}`)
        })
      } catch (err) {
        console.error(`  ✗ AI Error:`, err instanceof Error ? err.message : err)
      }
    } else {
      console.log('\n[Step 2] Skipped - ANTHROPIC_API_KEY not set')
    }
  } catch (err) {
    console.error(`  ✗ Fetch Error:`, err instanceof Error ? err.message : err)
  }
}

main()
