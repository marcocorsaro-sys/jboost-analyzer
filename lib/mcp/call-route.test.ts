/**
 * MCP — in-process route caller tests (pure: fake handlers, no Next).
 * Run: npx tsx --test lib/mcp/call-route.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpToolError } from '@/lib/mcp/types'
import { callRoute, expectOk, routeErrorMessage, type RouteHandler } from '@/lib/mcp/call-route'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('callRoute builds the request from origin + path + query and sends only content-type', async () => {
  let seen: Request | null = null
  const handler: RouteHandler = async (request) => {
    seen = request
    return json({ ok: 1 })
  }
  const result = await callRoute(handler, {
    origin: 'https://jboost.example/',
    method: 'POST',
    path: '/api/v4/analyses/abc/retry',
    query: { stage: 'active', skipped: undefined, n: 2 },
    body: { driver: 'speed' },
  })

  assert.ok(seen)
  const req = seen as Request
  assert.equal(req.url, 'https://jboost.example/api/v4/analyses/abc/retry?stage=active&n=2')
  assert.equal(req.method, 'POST')
  // Nothing but content-type: the bearer must come from the ambient context.
  assert.deepEqual([...req.headers.keys()], ['content-type'])
  assert.equal(req.headers.get('content-type'), 'application/json')
  assert.deepEqual(await req.json(), { driver: 'speed' })
  assert.deepEqual(result, { status: 200, ok: true, json: { ok: 1 } })
})

test('callRoute sends no body on GET even if one is given', async () => {
  const handler: RouteHandler = async (request) => {
    assert.equal(request.method, 'GET')
    assert.equal(await request.text(), '')
    return json({})
  }
  const result = await callRoute(handler, { origin: 'https://x.test', method: 'GET', path: '/api/x', body: { a: 1 } })
  assert.equal(result.ok, true)
})

test('callRoute params work for async-params and sync-params route styles', async () => {
  // v4 style: `await context.params`
  const asyncStyle = (async (_req: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params
    return json({ id })
  }) as RouteHandler
  // /api/clients/[id] style: `params.id` read directly
  const syncStyle = (async (_req: Request, { params }: { params: { id: string } }) =>
    json({ id: params.id })) as RouteHandler

  const opts = { origin: 'https://x.test', method: 'GET', path: '/x', params: { id: 'abc' } } as const
  assert.deepEqual((await callRoute(asyncStyle, opts)).json, { id: 'abc' })
  assert.deepEqual((await callRoute(syncStyle, opts)).json, { id: 'abc' })
})

test('callRoute returns non-2xx results without throwing, and parses text / empty bodies', async () => {
  const notFound = await callRoute(async () => json({ error: 'analysis not found or no access' }, 404), {
    origin: 'https://x.test',
    method: 'GET',
    path: '/x',
  })
  assert.equal(notFound.status, 404)
  assert.equal(notFound.ok, false)

  const text = await callRoute(async () => new Response('plain failure', { status: 502 }), {
    origin: 'https://x.test',
    method: 'GET',
    path: '/x',
  })
  assert.equal(text.json, 'plain failure')

  const empty = await callRoute(async () => new Response(null, { status: 204 }), {
    origin: 'https://x.test',
    method: 'GET',
    path: '/x',
  })
  assert.equal(empty.json, null)
  assert.equal(empty.ok, true)
})

test('callRoute turns a throwing handler into a readable McpToolError', async () => {
  await assert.rejects(
    callRoute(
      async () => {
        throw new Error('boom')
      },
      { origin: 'https://x.test', method: 'POST', path: '/api/y' },
    ),
    (err: unknown) => err instanceof McpToolError && /POST \/api\/y failed before answering: boom/.test(err.message),
  )
})

test('expectOk returns the body on 2xx (including 207/202)', () => {
  assert.deepEqual(expectOk({ status: 202, ok: true, json: { status: 'accepted' } }, 'x'), { status: 'accepted' })
  assert.deepEqual(expectOk({ status: 207, ok: true, json: { dispatchErrors: ['a'] } }, 'x'), { dispatchErrors: ['a'] })
})

test('expectOk maps non-2xx to McpToolError carrying error + details', () => {
  const result = {
    status: 400,
    ok: false,
    json: { error: 'setup invalid', details: ['il brand name del cliente è obbligatorio', 'il site type è obbligatorio'] },
  }
  assert.throws(
    () => expectOk(result, 'create_audit'),
    (err: unknown) => {
      assert.ok(err instanceof McpToolError)
      assert.match(err.message, /^create_audit: setup invalid: il brand name del cliente è obbligatorio \| il site type è obbligatorio \(HTTP 400\)$/)
      assert.deepEqual((err.details as { status: number }).status, 400)
      return true
    },
  )
})

test('expectOk adds a reconnect hint on 401 and survives odd bodies', () => {
  assert.throws(
    () => expectOk({ status: 401, ok: false, json: { error: 'unauthorized' } }, 'get_audit'),
    (err: unknown) => err instanceof McpToolError && /unauthorized \(HTTP 401\).*reconnect/.test(err.message),
  )
  assert.equal(routeErrorMessage({ status: 500, ok: false, json: null }), 'no error message returned (HTTP 500)')
  assert.equal(routeErrorMessage({ status: 502, ok: false, json: 'Bad gateway' }), 'Bad gateway (HTTP 502)')
  assert.equal(
    routeErrorMessage({ status: 409, ok: false, json: { error: 'non pubblicabile', progress: { pending: 2 } } }),
    'non pubblicabile (HTTP 409)',
  )
  assert.equal(
    routeErrorMessage({ status: 400, ok: false, json: { error: 'invalid body', details: 'Required at "drivers"' } }),
    'invalid body: Required at "drivers" (HTTP 400)',
  )
})
