import test from 'node:test'
import assert from 'node:assert/strict'
import { handleBody, handleMessage, renderToolText, MAX_RESULT_CHARS, describeTool } from './jsonrpc'
import {
  bearerTokenFromHeader,
  originFromHeaders,
  protectedResourceMetadataUrl,
  wwwAuthenticate,
  jwtClaims,
} from './auth'
import { safeNextPath } from './safe-next'
import { summarizeUsage } from './usage'
import { McpToolError, type McpTool } from './types'

const ctx = { userId: 'u1', email: 'a@b.it', origin: 'https://x.test' }
const echo: McpTool = {
  name: 'echo', title: 'Echo', description: 'd', inputSchema: { type: 'object' }, readOnly: true,
  async run(args) { return { data: { args } } },
  analysisIdOf: () => 'aid',
}
const boom: McpTool = { ...echo, name: 'boom', readOnly: false, async run() { throw new McpToolError('nope', { why: 1 }) } }
const crash: McpTool = { ...echo, name: 'crash', async run() { throw new Error('x') } }
const opts = (calls: unknown[] = []) => ({ tools: [echo, boom, crash], ctx, onToolCall: (r: unknown) => { calls.push(r) } })

test('initialize negotiates a supported protocol version', async () => {
  const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, opts())
  assert.equal(r.result.protocolVersion, '2025-03-26')
  assert.ok(r.result.capabilities.tools)
  const r2: any = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, opts())
  assert.equal(r2.result.protocolVersion, '2025-06-18')
})

test('notifications get no reply, batch of notifications -> null', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, opts()), null)
  assert.equal(await handleBody([{ jsonrpc: '2.0', method: 'notifications/initialized' }], opts()), null)
})

test('tools/list exposes annotations', async () => {
  const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, opts())
  assert.equal(r.result.tools.length, 3)
  assert.equal(r.result.tools.find((t: any) => t.name === 'echo').annotations.readOnlyHint, true)
  assert.equal(describeTool(boom).annotations.readOnlyHint, false)
})

test('tools/call: success, McpToolError and crash are results, unknown tool is a protocol error; usage hook fires', async () => {
  const calls: any[] = []
  const ok: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 } } }, opts(calls))
  assert.equal(ok.result.isError, undefined)
  assert.match(ok.result.content[0].text, /"a":1|"a": 1/)
  const bad: any = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'boom' } }, opts(calls))
  assert.equal(bad.result.isError, true)
  assert.match(bad.result.content[0].text, /nope/)
  const cr: any = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'crash' } }, opts(calls))
  assert.equal(cr.result.isError, true)
  const unk: any = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'zzz' } }, opts(calls))
  assert.ok(unk.error)
  assert.equal(calls.length, 3)
  assert.equal(calls[0].tool, 'echo'); assert.equal(calls[0].analysisId, 'aid'); assert.equal(calls[0].ok, true)
  assert.equal(calls[1].ok, false)
})

test('a throwing usage hook never breaks the call', async () => {
  const r: any = await handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo' } },
    { tools: [echo], ctx, onToolCall: () => { throw new Error('db down') } },
  )
  assert.equal(r.result.isError, undefined)
})

test('unknown method -> -32601; ping -> {}', async () => {
  const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'nope' }, opts())
  assert.equal(r.error.code, -32601)
  const p: any = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping' }, opts())
  assert.deepEqual(p.result, {})
})

test('renderToolText truncates oversized output', () => {
  const t = renderToolText({ blob: 'x'.repeat(MAX_RESULT_CHARS * 2) })
  assert.ok(t.length < MAX_RESULT_CHARS + 500)
})

test('bearer parsing', () => {
  assert.equal(bearerTokenFromHeader('Bearer abc.def'), 'abc.def')
  assert.equal(bearerTokenFromHeader('bearer   t'), 't')
  assert.equal(bearerTokenFromHeader('Basic x'), null)
  assert.equal(bearerTokenFromHeader(null), null)
})

test('origin + challenge', () => {
  const h = new Headers({ 'x-forwarded-host': 'jboost.example', 'x-forwarded-proto': 'https' })
  const prev = process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.NEXT_PUBLIC_SITE_URL
  assert.equal(originFromHeaders(h), 'https://jboost.example')
  process.env.NEXT_PUBLIC_SITE_URL = 'https://fixed.example/'
  assert.equal(originFromHeaders(h), 'https://fixed.example')
  if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = prev
  assert.equal(protectedResourceMetadataUrl('https://a.b'), 'https://a.b/.well-known/oauth-protected-resource/api/mcp')
  assert.match(wwwAuthenticate('https://a.b'), /^Bearer resource_metadata="https:\/\/a\.b\//)
  assert.match(wwwAuthenticate('https://a.b', 'invalid_token'), /error="invalid_token"/)
})

test('jwtClaims decodes payload, tolerates garbage', () => {
  const payload = Buffer.from(JSON.stringify({ client_id: 'c1' })).toString('base64url')
  assert.equal(jwtClaims(`h.${payload}.s`).client_id, 'c1')
  assert.deepEqual(jwtClaims('garbage'), {})
})

test('safeNextPath blocks open redirects', () => {
  assert.equal(safeNextPath('/oauth/consent?authorization_id=1'), '/oauth/consent?authorization_id=1')
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:1', '', null, undefined, '/a\nb']) {
    assert.equal(safeNextPath(bad as string), null)
  }
})

test('summarizeUsage', () => {
  const s = summarizeUsage([
    { user_id: 'a', email: 'a@x', created_at: '2026-10-01T10:00:00Z' },
    { user_id: 'a', email: 'a@x', created_at: '2026-10-03T10:00:00Z' },
    { user_id: 'b', email: null, created_at: '2026-10-02T10:00:00Z' },
  ])
  assert.equal(s.totalCalls, 3); assert.equal(s.people, 2)
  assert.equal(s.lastCallAt, '2026-10-03T10:00:00Z')
  assert.equal(s.perPerson[0].email, 'a@x'); assert.equal(s.perPerson[0].calls, 2)
  assert.equal(summarizeUsage([]).lastCallAt, null)
})
