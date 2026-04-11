import { anthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'
import { NextResponse } from 'next/server'

export const maxDuration = 60

// GET: test the streamText pipeline (same SDK/model as /api/chat)
export async function GET() {
  const diagnostics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    sdk_test: {},
  }

  const hasKey = !!process.env.ANTHROPIC_API_KEY
  diagnostics.env = { ANTHROPIC_API_KEY_present: hasKey }

  if (!hasKey) {
    diagnostics.error = 'ANTHROPIC_API_KEY not set'
    return NextResponse.json(diagnostics, { status: 500 })
  }

  try {
    const result = streamText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: 'Sei un assistente. Rispondi in una frase.',
      messages: [{ role: 'user' as const, content: 'Ciao, funzioni?' }],
      maxTokens: 100,
      temperature: 0.7,
    })

    let fullText = ''
    for await (const chunk of result.textStream) {
      fullText += chunk
    }

    diagnostics.sdk_test = {
      success: true,
      model: 'claude-sonnet-4-20250514',
      response_length: fullText.length,
      response_preview: fullText.slice(0, 200),
    }
    diagnostics.success = true
  } catch (err) {
    diagnostics.sdk_test = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined,
    }
    diagnostics.error = `AI SDK streamText failed: ${err instanceof Error ? err.message : String(err)}`
    return NextResponse.json(diagnostics, { status: 500 })
  }

  return NextResponse.json(diagnostics)
}

// POST: simulate the actual chat flow with toDataStreamResponse()
// Call with: curl -X POST .../api/chat-test -d '{"messages":[{"role":"user","content":"Ciao"}]}'
export async function POST(req: Request) {
  const hasKey = !!process.env.ANTHROPIC_API_KEY
  if (!hasKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json()
    const messages = body.messages || [{ role: 'user', content: 'Ciao, funzioni?' }]

    const result = streamText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: 'Sei Ask J, un assistente AI. Rispondi in italiano in modo conciso.',
      messages,
      maxTokens: 200,
      temperature: 0.7,
    })

    // This is the exact same return method used in /api/chat
    return result.toDataStreamResponse()
  } catch (err) {
    console.error('[chat-test POST] Error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
