/**
 * MCP connector — in-process caller for the existing /api/* route handlers.
 *
 * Every MCP tool is a thin wrapper over a route the web app already uses, so
 * auth, RLS and every guard stay identical. This helper builds a synthetic
 * `Request`, hands it to the route's exported handler and returns the parsed
 * answer.
 *
 * What it deliberately does NOT do: forward credentials. The synthetic
 * request carries a content-type and nothing else. The caller's bearer token
 * reaches `createClient()` through the ambient request context (next/headers
 * inside the MCP request), so a route invoked from here authenticates as the
 * MCP caller exactly as it would for the browser.
 */

import { McpToolError } from '@/lib/mcp/types'

/**
 * A Next route handler, as the module exports it. The context is typed
 * `never` on purpose: routes declare either `{ params: Promise<{...}> }`
 * (the v4 routes) or `{ params: {...} }` (the older /api/clients/[id]), and
 * `never` accepts both without an `any`. callRoute builds the real value.
 */
export type RouteHandler = (request: Request, context: never) => Response | Promise<Response>

export type RouteMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface CallRouteOptions {
  /** Public origin of this deployment (McpToolContext.origin). Routes use it
   *  to dispatch background workers (resolveBaseUrl(request)). */
  origin: string
  method: RouteMethod
  /** Absolute path with dynamic segments already filled, e.g. /api/v4/analyses/<id>/status */
  path: string
  query?: Record<string, string | number | boolean | undefined>
  /** JSON body. Ignored for GET. */
  body?: unknown
  /** Dynamic segments the handler reads from `context.params`. */
  params?: Record<string, string>
}

export interface RouteResult {
  status: number
  ok: boolean
  /** Parsed JSON; the raw text when the body is not JSON; null when empty. */
  json: unknown
}

/**
 * `context.params` that works for both route styles: a Promise (v4 routes
 * `await context.params`) that ALSO exposes the keys synchronously
 * (/api/clients/[id] reads `params.id` directly).
 */
function buildParams(params: Record<string, string>): Promise<Record<string, string>> & Record<string, string> {
  return Object.assign(Promise.resolve(params), params)
}

function buildUrl({ origin, path, query }: Pick<CallRouteOptions, 'origin' | 'path' | 'query'>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(key, String(value))
  }
  const qs = search.toString()
  return `${origin.replace(/\/$/, '')}${path}${qs ? `?${qs}` : ''}`
}

/** JSON when it parses, the raw text otherwise, null for an empty body. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/**
 * Invoke a route handler in-process. Never throws on a non-2xx answer (the
 * caller decides; see expectOk). It does throw McpToolError when the handler
 * itself blows up, so the model gets a readable failure instead of a
 * protocol error.
 */
export async function callRoute(handler: RouteHandler, options: CallRouteOptions): Promise<RouteResult> {
  const { method, body, params = {} } = options
  const url = buildUrl(options)
  const hasBody = method !== 'GET' && body !== undefined

  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: hasBody ? JSON.stringify(body) : undefined,
  })

  let response: Response
  try {
    response = await handler(request, { params: buildParams(params) } as never)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new McpToolError(`${method} ${options.path} failed before answering: ${message}`)
  }

  return { status: response.status, ok: response.ok, json: await readBody(response) }
}

function stringifyDetails(details: unknown): string | null {
  if (details === undefined || details === null || details === '') return null
  if (typeof details === 'string') return details
  if (Array.isArray(details)) {
    const parts = details.map((d) => (typeof d === 'string' ? d : JSON.stringify(d)))
    return parts.join(' | ')
  }
  return JSON.stringify(details)
}

/**
 * The message the model should see for a failed route: the route's own
 * `error` plus its `details` (setup validation lists every problem there).
 */
export function routeErrorMessage(result: RouteResult): string {
  const json = result.json
  const parts: string[] = []
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const body = json as Record<string, unknown>
    if (typeof body.error === 'string' && body.error) parts.push(body.error)
    const details = stringifyDetails(body.details)
    if (details) parts.push(details)
    if (parts.length === 0 && typeof body.message === 'string') parts.push(body.message)
  } else if (typeof json === 'string' && json) {
    parts.push(json.slice(0, 300))
  }
  if (parts.length === 0) parts.push('no error message returned')
  return `${parts.join(': ')} (HTTP ${result.status})`
}

/** Map a non-2xx RouteResult to McpToolError; return the parsed body otherwise. */
export function expectOk(result: RouteResult, label: string): unknown {
  if (result.ok) return result.json
  let message = `${label}: ${routeErrorMessage(result)}`
  if (result.status === 401) {
    message += ' — the session is not authenticated; the user must reconnect the connector.'
  }
  throw new McpToolError(message, { status: result.status, body: result.json })
}
