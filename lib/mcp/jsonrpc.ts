/**
 * MCP connector — JSON-RPC 2.0 / MCP protocol core (Streamable HTTP, POST only).
 *
 * Pure: it knows nothing about Next, Supabase or auth. The route hands it a
 * parsed body, the authenticated context and the tool registry, and gets back
 * the JSON to send (or null when the message was only a notification).
 *
 * Hand-rolled on purpose: the surface we need is tiny (initialize, ping,
 * tools/list, tools/call) and it keeps the connector free of an SDK that this
 * environment cannot install or typecheck.
 */

import { McpToolError, type McpTool, type McpToolContext } from '@/lib/mcp/types'

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

export const SERVER_INFO = { name: 'jboost-analyzer', title: 'J-Boost Analyzer', version: '1.0.0' }

export const SERVER_INSTRUCTIONS = [
  'J-Boost Analyzer runs SEO/GEO audits (10 drivers, Leader-Index scoring) for Jakala.',
  'Start with list_audits to find an audit id, then get_audit for its status and scores, get_driver for one driver\'s evidence, get_insights for the written insights.',
  'Reads are free. Write tools (create_audit, start_audit, rerun_drivers, generate_insights, resolve_decision, set_global_notes, publish_audit) change data and many spend paid API units: only call them when the user asks.',
  'Numbers come from the audit data verbatim: never recompute or invent scores, sites or competitors. A driver in "error" or a partial measurement is reported as such, never as 0.',
].join(' ')

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function isRequest(value: unknown): value is JsonRpcRequest {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    typeof (value as { method?: unknown }).method === 'string'
  )
}

/** Max characters of tool output handed to the model in one result. */
export const MAX_RESULT_CHARS = 60_000

/** Render a tool payload as compact JSON text, truncated with an explicit note. */
export function renderToolText(data: unknown): string {
  let text: string
  try {
    text = typeof data === 'string' ? data : JSON.stringify(data)
  } catch {
    text = String(data)
  }
  if (text === undefined) text = 'null'
  if (text.length <= MAX_RESULT_CHARS) return text
  return (
    text.slice(0, MAX_RESULT_CHARS) +
    `\n…[output truncated at ${MAX_RESULT_CHARS} characters; ask for a narrower query]`
  )
}

export interface ToolCallRecord {
  tool: string
  analysisId: string | null
  ok: boolean
  error: string | null
  durationMs: number
}

export interface HandleOptions {
  tools: McpTool[]
  ctx: McpToolContext
  /** Called once per tools/call, after it finished (usage log). Must not throw. */
  onToolCall?: (record: ToolCallRecord) => void | Promise<void>
}

/** Public shape of a tool in tools/list (no functions). */
export function describeTool(tool: McpTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.readOnly
      ? { title: tool.title, readOnlyHint: true, openWorldHint: false }
      : { title: tool.title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }
}

async function callTool(
  params: Record<string, unknown> | undefined,
  { tools, ctx, onToolCall }: HandleOptions,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const name = typeof params?.name === 'string' ? params.name : null
  if (!name) return { error: { code: ERR.invalidParams, message: 'tools/call requires a tool name' } }
  const tool = tools.find((t) => t.name === name)
  if (!tool) return { error: { code: ERR.invalidParams, message: `Unknown tool: ${name}` } }

  const args = params?.arguments ?? {}
  const startedAt = Date.now()
  let analysisId: string | null = null
  try {
    analysisId = tool.analysisIdOf?.(args) ?? null
  } catch {
    analysisId = null
  }

  let ok = true
  let errorText: string | null = null
  let result: { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
  try {
    const out = await tool.run(args, ctx)
    ok = !out.isError
    if (out.isError) errorText = renderToolText(out.data).slice(0, 300)
    result = {
      content: [{ type: 'text', text: renderToolText(out.data) }],
      ...(out.isError ? { isError: true } : {}),
    }
  } catch (err) {
    ok = false
    // Tool-level failures are results the model can act on, not protocol errors.
    const message =
      err instanceof McpToolError
        ? err.details === undefined
          ? err.message
          : `${err.message}\n${renderToolText(err.details)}`
        : `The tool failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`
    errorText = message.slice(0, 300)
    result = { content: [{ type: 'text', text: message }], isError: true }
  }

  try {
    await onToolCall?.({ tool: name, analysisId, ok, error: errorText, durationMs: Date.now() - startedAt })
  } catch {
    // The usage log is never load-bearing.
  }
  return { result }
}

/** Handle ONE message. Returns null for notifications / responses (no reply). */
export async function handleMessage(message: unknown, opts: HandleOptions): Promise<JsonRpcResponse | null> {
  if (!isRequest(message)) {
    // A client response or garbage: nothing to answer unless it looked like a request.
    const id = (message as { id?: JsonRpcId } | null)?.id
    if (message && typeof message === 'object' && 'method' in (message as object)) {
      return rpcError(id ?? null, ERR.invalidRequest, 'Invalid JSON-RPC request')
    }
    return null
  }

  const isNotification = message.id === undefined
  const id: JsonRpcId = message.id ?? null

  switch (message.method) {
    case 'initialize': {
      const asked = typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : ''
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
        ? asked
        : LATEST_PROTOCOL_VERSION
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        },
      }
    }
    case 'ping':
      return isNotification ? null : { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: opts.tools.map(describeTool) } }
    case 'tools/call': {
      const out = await callTool(message.params, opts)
      return out.error ? rpcError(id, out.error.code, out.error.message) : { jsonrpc: '2.0', id, result: out.result }
    }
    // Capabilities we do not advertise, but polite clients still probe.
    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: [] } }
    case 'resources/templates/list':
      return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } }
    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: [] } }
    default:
      if (isNotification || message.method.startsWith('notifications/')) return null
      return rpcError(id, ERR.methodNotFound, `Method not found: ${message.method}`)
  }
}

/**
 * Handle a parsed POST body: a single message or a batch. `null` = nothing to
 * send back (HTTP 202).
 */
export async function handleBody(
  body: unknown,
  opts: HandleOptions,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return rpcError(null, ERR.invalidRequest, 'Empty batch')
    const replies = (await Promise.all(body.map((m) => handleMessage(m, opts)))).filter(
      (r): r is JsonRpcResponse => r !== null,
    )
    return replies.length > 0 ? replies : null
  }
  return handleMessage(body, opts)
}

export function parseErrorResponse(): JsonRpcResponse {
  return rpcError(null, ERR.parse, 'Parse error')
}

export function internalErrorResponse(message: string): JsonRpcResponse {
  return rpcError(null, ERR.internal, message)
}
