import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callAnthropicWithUsage } from './jhorizon-extract'

function withFetch(replies: Array<{ status: number; body: unknown }>, run: (calls: Array<Record<string, unknown>>) => Promise<void>) {
  const original = globalThis.fetch
  const calls: Array<Record<string, unknown>> = []
  let i = 0
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    calls.push(JSON.parse(String(init?.body ?? '{}')))
    const r = replies[Math.min(i++, replies.length - 1)]
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  process.env.ANTHROPIC_API_KEY = 'test-key'
  return run(calls).finally(() => {
    globalThis.fetch = original
  })
}

const OK = { status: 200, body: { content: [{ text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } } }

test('a 400 about temperature is retried once without it', async () => {
  await withFetch(
    [{ status: 400, body: { error: { message: '`temperature` is not supported for this model' } } }, OK],
    async (calls) => {
      const out = await callAnthropicWithUsage('p', 'V4 Executive Summary', { model: 'claude-opus-4-8', temperature: 0.4 })
      assert.equal(out.text, 'ok')
      assert.equal(calls.length, 2)
      assert.equal('temperature' in calls[0], true)
      assert.equal('temperature' in calls[1], false)
    },
  )
})

test('a 400 for another reason is not retried and keeps Anthropic\'s reason in the error', async () => {
  await withFetch([{ status: 400, body: { error: { message: 'max_tokens too large' } } }], async (calls) => {
    await assert.rejects(
      callAnthropicWithUsage('p', 'V4 Executive Summary', { model: 'claude-opus-4-8', temperature: 0.4 }),
      /answered 400: .*max_tokens too large/,
    )
    assert.equal(calls.length, 1)
  })
})
