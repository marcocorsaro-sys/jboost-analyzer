import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' })

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const {
      analysisId,
      domain,
      overallScore,
      driverResults,
      companyContext,
      senderRole,
      recipientRole,
      wordCount = 250,
      language = 'en',
    } = await req.json()

    if (!analysisId || !driverResults) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const driverSummary = Object.entries(driverResults)
      .map(([name, result]: [string, unknown]) => {
        const r = result as { score: number | null; status: string }
        return `- ${name}: ${r.score ?? 'N/A'}/100 (${r.status})`
      })
      .join('\n')

    const prompt = `You are a ${senderRole || 'Digital Strategist'} writing an executive summary for a ${recipientRole || 'CMO'}.

Domain analyzed: ${domain}
Overall Score: ${overallScore ?? 'N/A'}/100

Driver Scores:
${driverSummary}

${companyContext ? `Company Context:\n${JSON.stringify(companyContext, null, 2)}` : ''}

Write a professional executive summary in ${language === 'it' ? 'Italian' : 'English'}, approximately ${wordCount} words.

Structure:
1. Opening — state of the domain's digital presence
2. Key findings — highlight strengths and critical areas
3. Priority actions — top 3-5 recommendations
4. Expected impact — what improvement can be expected
5. Closing — next steps

Tone: Professional, data-driven, actionable. Adapt to the recipient's role and perspective.
Use specific numbers from the analysis. Be direct and avoid vague statements.`

    const result = streamText({
      model: openai('gpt-4-turbo'),
      prompt,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    console.error('LLM executive-summary error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
