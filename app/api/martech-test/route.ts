import { NextResponse } from 'next/server'
import { fetchSiteSignals, classifyWithAI } from '@/lib/martech/detect'

export const maxDuration = 60

/**
 * GET /api/martech-test?domain=benetton.com
 *
 * Diagnostic endpoint to test martech detection pipeline.
 * Returns step-by-step results for debugging.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const domain = searchParams.get('domain') || 'kempinski.com'

  const diagnostics: Record<string, unknown> = {
    domain,
    timestamp: new Date().toISOString(),
    steps: {},
  }

  // Step 0: Check env
  const hasKey = !!process.env.ANTHROPIC_API_KEY
  const keyPrefix = process.env.ANTHROPIC_API_KEY?.slice(0, 10) || 'NOT_SET'
  diagnostics.steps = {
    ...diagnostics.steps as object,
    env: {
      ANTHROPIC_API_KEY_present: hasKey,
      ANTHROPIC_API_KEY_prefix: keyPrefix,
    },
  }

  if (!hasKey) {
    diagnostics.error = 'ANTHROPIC_API_KEY not set'
    return NextResponse.json(diagnostics, { status: 500 })
  }

  // Step 1: Fetch site signals
  let signals
  try {
    console.log(`[MarTech-Test] Fetching signals for ${domain}...`)
    signals = await fetchSiteSignals(domain)
    diagnostics.steps = {
      ...diagnostics.steps as object,
      fetch: {
        success: true,
        scripts: signals.scripts.length,
        links: signals.links.length,
        metas: signals.metas.length,
        jsonLd: signals.jsonLd.length,
        preconnects: signals.preconnects.length,
        noscripts: signals.noscripts.length,
        headerKeys: Object.keys(signals.headers),
        rawSnippetLength: signals.rawSnippet.length,
        sampleScripts: signals.scripts.slice(0, 5),
        sampleHeaders: Object.fromEntries(
          Object.entries(signals.headers).slice(0, 10)
        ),
        sampleJsonLd: signals.jsonLd.slice(0, 2),
        samplePreconnects: signals.preconnects.slice(0, 5),
      },
    }
  } catch (err) {
    diagnostics.steps = {
      ...diagnostics.steps as object,
      fetch: {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined,
      },
    }
    diagnostics.error = 'Fetch failed'
    return NextResponse.json(diagnostics, { status: 500 })
  }

  // Step 2: AI classification
  try {
    console.log(`[MarTech-Test] Running AI classification...`)
    const { tools, usage } = await classifyWithAI(domain, signals)
    diagnostics.steps = {
      ...diagnostics.steps as object,
      ai: {
        success: true,
        toolCount: tools.length,
        usage,
        tools: tools.map(t => ({
          name: t.tool_name,
          category: t.category,
          confidence: t.confidence,
          version: t.tool_version,
          evidence: t.details,
        })),
      },
    }
    diagnostics.success = true
  } catch (err) {
    diagnostics.steps = {
      ...diagnostics.steps as object,
      ai: {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined,
      },
    }
    diagnostics.error = 'AI classification failed'
    return NextResponse.json(diagnostics, { status: 500 })
  }

  return NextResponse.json(diagnostics)
}
