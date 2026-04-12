import { NextResponse } from 'next/server'
import { detectMartechStack } from '@/lib/martech/detect'

export const maxDuration = 180

/**
 * GET /api/martech-test?domain=benetton.com
 *
 * Diagnostic endpoint to test V3 martech detection pipeline.
 * Returns full results including completeness, maturity, gaps, and recommendations.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const domain = searchParams.get('domain') || 'kempinski.com'

  const diagnostics: Record<string, unknown> = {
    domain,
    timestamp: new Date().toISOString(),
  }

  // Check env
  const hasKey = !!process.env.ANTHROPIC_API_KEY
  diagnostics.env = {
    ANTHROPIC_API_KEY_present: hasKey,
    ANTHROPIC_API_KEY_prefix: process.env.ANTHROPIC_API_KEY?.slice(0, 10) || 'NOT_SET',
  }

  if (!hasKey) {
    diagnostics.error = 'ANTHROPIC_API_KEY not set'
    return NextResponse.json(diagnostics, { status: 500 })
  }

  try {
    console.log(`[MarTech-Test] Starting V3 detection for ${domain}...`)
    const startTime = Date.now()

    const result = await detectMartechStack(domain)

    const duration = Date.now() - startTime

    diagnostics.success = true
    diagnostics.duration_ms = duration
    diagnostics.toolCount = result.tools.length
    diagnostics.usage = result.usage
    diagnostics.completeness = result.completeness
    diagnostics.maturityScore = result.maturityScore
    diagnostics.maturityTier = result.maturityTier
    diagnostics.gapAnalysis = result.gapAnalysis
    diagnostics.recommendations = result.recommendations
    diagnostics.tools = result.tools.map(t => ({
      name: t.tool_name,
      category: t.category,
      confidence: t.confidence,
      version: t.tool_version,
      details: t.details,
    }))

  } catch (err) {
    diagnostics.success = false
    diagnostics.error = err instanceof Error ? err.message : String(err)
    diagnostics.stack = err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined
    return NextResponse.json(diagnostics, { status: 500 })
  }

  return NextResponse.json(diagnostics)
}
