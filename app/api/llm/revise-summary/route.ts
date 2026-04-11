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
      currentSummary,
      userFeedback,
      domain,
      overallScore,
      driverResults,
      language = 'en',
    } = await req.json()

    if (!currentSummary || !userFeedback) {
      return new Response(JSON.stringify({ error: 'Missing currentSummary or userFeedback' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const prompt = `You are revising an executive summary based on user feedback.

Domain: ${domain}
Overall Score: ${overallScore ?? 'N/A'}/100

Current Summary:
---
${currentSummary}
---

User Feedback:
"${userFeedback}"

${driverResults ? `Driver Scores for reference:\n${JSON.stringify(driverResults, null, 2)}` : ''}

Revise the executive summary incorporating the user's feedback. Write in ${language === 'it' ? 'Italian' : 'English'}.
Maintain the professional tone and data-driven approach. Keep the same general structure unless the feedback specifically requests a different format.`

    const result = streamText({
      model: openai('gpt-4-turbo'),
      prompt,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    console.error('LLM revise-summary error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
