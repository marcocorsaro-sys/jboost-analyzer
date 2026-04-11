import { NextResponse } from 'next/server'
import { detectMartechStack } from '@/lib/martech/detect'

export const maxDuration = 120

/**
 * GET /api/martech-test?domain=benetton.com
 *
 * Diagnostic endpoint to test enhanced martech detection pipeline.
 * Returns full results including completeness report for debugging.
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
    console.log(`[MarTech-Test] Starting enhanced detection for ${domain}...`)
    const startTime = Date.now()

    const { tools, usage, completeness } = await detectMartechStack(domain)

    const duration = Date.now() - startTime

    diagnostics.success = true
    diagnostics.duration_ms = duration
    diagnostics.toolCount = tools.length
    diagnostics.usage = usage
    diagnostics.completeness = completeness
    diagnostics.tools = tools.map(t => ({
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
