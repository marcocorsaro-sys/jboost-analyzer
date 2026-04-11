import { detectMartechStack } from '../lib/martech/detect'

async function main() {
  const domain = process.argv[2] || 'benetton.com'

  console.log(`\n=== Testing Enhanced MarTech Detection for ${domain} ===\n`)

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set')
    process.exit(1)
  }

  try {
    const startTime = Date.now()
    const { tools, usage, completeness } = await detectMartechStack(domain)
    const duration = Date.now() - startTime

    console.log(`\n=== Results (${Math.round(duration / 1000)}s) ===\n`)
    console.log(`Detected ${tools.length} tools:`)
    tools.forEach(t => {
      console.log(`  - ${t.tool_name} (${t.category}) confidence: ${t.confidence}`)
    })

    console.log(`\nUsage: ${usage.input_tokens} in / ${usage.output_tokens} out tokens`)

    console.log(`\nCompleteness: ${completeness.score}/100 (${completeness.level})`)
    console.log(`Pages scanned: ${completeness.pagesScanned}`)
    console.log(`Total signals: ${completeness.totalSignals}`)
    console.log(`\nDiagnostics:`)
    completeness.diagnostics.forEach(d => {
      console.log(`  [${d.type}] ${d.message}`)
    })
  } catch (err) {
    console.error(`Error:`, err instanceof Error ? err.message : err)
  }
}

main()
