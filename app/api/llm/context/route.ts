import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' })

const ContextSchema = z.object({
  company_profile: z.string().describe('Brief company profile and main business description'),
  market_scenario: z.string().describe('Current market scenario and competitive landscape'),
  main_challenges: z.array(z.string()).describe('Top 3-5 digital challenges the company faces'),
  recent_news: z.array(z.string()).describe('Any relevant recent news or developments'),
  industry_trends: z.array(z.string()).describe('Key industry trends affecting this company'),
  target_audience: z.string().describe('Likely target audience description'),
})

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { analysisId, domain, targetTopic } = await req.json()

    if (!domain) {
      return NextResponse.json({ error: 'Missing domain' }, { status: 400 })
    }

    const prompt = `You are a business analyst researching a company for an SEO/digital marketing assessment.

Domain: ${domain}
${targetTopic ? `Focus Area: ${targetTopic}` : ''}

Research and provide a comprehensive context about this company/website:
1. Company profile — what does this company do?
2. Market scenario — who are their competitors and what's the market like?
3. Main challenges — what digital/SEO challenges might they face?
4. Recent news — any notable developments?
5. Industry trends — key trends in their industry
6. Target audience — who are they trying to reach?

Be concise but informative. If you're not sure about specific details, provide reasonable inferences based on the domain name and common patterns.`

    const result = await generateObject({
      model: openai('gpt-4-turbo'),
      schema: ContextSchema,
      prompt,
    })

    // Save context to analysis
    if (analysisId) {
      await supabase
        .from('analyses')
        .update({ company_context: result.object })
        .eq('id', analysisId)
    }

    return NextResponse.json(result.object)
  } catch (error) {
    console.error('LLM context error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
