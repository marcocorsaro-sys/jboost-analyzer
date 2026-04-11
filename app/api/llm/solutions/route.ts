import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' })

const SolutionSchema = z.object({
  solutions: z.array(z.object({
    title: z.string().describe('Brief title of the solution'),
    description: z.string().describe('Detailed description of the action to take'),
    impact: z.enum(['high', 'medium', 'low']).describe('Expected impact level'),
    effort: z.enum(['high', 'medium', 'low']).describe('Implementation effort'),
    estimated_improvement: z.number().min(0).max(30).describe('Estimated score improvement (0-30 points)'),
    timeframe: z.string().describe('Estimated timeframe, e.g. "2-4 weeks"'),
    category: z.string().describe('Category: quick-win, strategic, maintenance'),
  }))
})

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { analysisId, driverName, score, issues, domain, companyContext, clientId } = await req.json()

    if (!analysisId || !driverName) {
      return NextResponse.json({ error: 'Missing analysisId or driverName' }, { status: 400 })
    }

    const prompt = `You are an expert SEO and digital marketing consultant analyzing a website's performance.

Domain: ${domain || 'Unknown'}
Driver: ${driverName}
Current Score: ${score ?? 'N/A'}/100
${companyContext ? `Company Context: ${JSON.stringify(companyContext)}` : ''}

Issues found:
${issues && issues.length > 0 ? issues.map((i: string, idx: number) => `${idx + 1}. ${i}`).join('\n') : 'No specific issues detected.'}

Based on the score and issues above, provide 3-5 actionable solutions to improve the "${driverName}" score. Each solution should be specific, measurable, and include a realistic timeframe.

Focus on:
- Quick wins that can be implemented immediately
- Strategic improvements that have high impact
- Best practices for this specific driver

Provide solutions in order of priority (highest impact first).`

    const result = await generateObject({
      model: openai('gpt-4-turbo'),
      schema: SolutionSchema,
      prompt,
    })

    // Track LLM cost (non-blocking)
    trackLlmUsage({
      userId: user.id,
      clientId: clientId || null,
      provider: 'openai',
      model: 'gpt-4-turbo',
      operation: 'llm_solutions',
      inputTokens: result.usage.promptTokens || 0,
      outputTokens: result.usage.completionTokens || 0,
      metadata: { domain, driverName, analysisId },
    }).catch(() => {})

    // Save solutions to driver_results
    await supabase
      .from('driver_results')
      .update({ solutions: result.object.solutions })
      .eq('analysis_id', analysisId)
      .eq('driver_name', driverName)

    return NextResponse.json(result.object)
  } catch (error) {
    console.error('LLM solutions error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
