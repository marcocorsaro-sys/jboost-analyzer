import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { trackLlmUsage } from '@/lib/tracking/llm-usage'

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' })

const MatrixItemSchema = z.object({
  title: z.string(),
  driver: z.string(),
  description: z.string(),
  impact_score: z.number().min(1).max(10),
  effort_score: z.number().min(1).max(10),
})

const PriorityMatrixSchema = z.object({
  opportunities: z.array(MatrixItemSchema).describe('High priority + High impact items'),
  issues: z.array(MatrixItemSchema).describe('High priority + Lower impact items'),
  improvements: z.array(MatrixItemSchema).describe('Medium priority + High impact items'),
  suggestions: z.array(MatrixItemSchema).describe('Low priority items'),
})

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { analysisId, clientId } = await req.json()

    if (!analysisId) {
      return NextResponse.json({ error: 'Missing analysisId' }, { status: 400 })
    }

    // Fetch all driver results with solutions
    const { data: driverResults } = await supabase
      .from('driver_results')
      .select('*')
      .eq('analysis_id', analysisId)

    if (!driverResults || driverResults.length === 0) {
      return NextResponse.json({ error: 'No driver results found' }, { status: 404 })
    }

    const driverSummary = driverResults.map(dr => ({
      driver: dr.driver_name,
      score: dr.score,
      status: dr.status,
      solutions: dr.solutions || [],
      issues: dr.issues || [],
    }))

    const prompt = `You are a strategic SEO consultant creating a priority matrix for website optimization.

Analysis results:
${JSON.stringify(driverSummary, null, 2)}

Classify ALL solutions and issues across all drivers into 4 quadrants:
1. **Opportunities** (Quick Wins): High impact + Low effort — do these FIRST
2. **Issues** (Must Fix): High priority problems that need immediate attention
3. **Improvements** (Strategic): High impact but require more effort — plan for these
4. **Suggestions** (Nice to Have): Lower priority but good for long-term

For each item provide:
- A clear title
- Which driver it relates to
- Brief description
- Impact score (1-10)
- Effort score (1-10)

Aim for 2-4 items per quadrant. Focus on the most actionable items.`

    const result = await generateObject({
      model: openai('gpt-4-turbo'),
      schema: PriorityMatrixSchema,
      prompt,
    })

    // Track LLM cost (non-blocking)
    trackLlmUsage({
      userId: user.id,
      clientId: clientId || null,
      provider: 'openai',
      model: 'gpt-4-turbo',
      operation: 'llm_priority_matrix',
      inputTokens: result.usage.promptTokens || 0,
      outputTokens: result.usage.completionTokens || 0,
      metadata: { analysisId },
    }).catch(() => {})

    // Save to priority_matrix table
    await supabase
      .from('priority_matrix')
      .upsert({
        analysis_id: analysisId,
        opportunities: result.object.opportunities,
        issues: result.object.issues,
        improvements: result.object.improvements,
        suggestions: result.object.suggestions,
      }, { onConflict: 'analysis_id' })

    return NextResponse.json(result.object)
  } catch (error) {
    console.error('LLM priority-matrix error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
