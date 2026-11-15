/**
 * Telegram bot — runs JBA tools through the app's own /api/mcp endpoint with
 * the linked user's access token. Same path as the Claude connector: token
 * verified on every call, RLS of THAT user, every route guard, usage log.
 */

import { MCP_TOOLS } from '@/lib/mcp/tools'
import type { AgentTool } from '@/lib/telegram/agent'

export function botTools(): AgentTool[] {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    readOnly: t.readOnly,
  }))
}

interface ToolCallReply {
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }
  error?: { message?: string }
}

export async function callJbaTool(
  origin: string,
  accessToken: string,
  name: string,
  args: unknown,
): Promise<{ text: string; isError: boolean }> {
  const res = await fetch(`${origin.replace(/\/$/, '')}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args ?? {} } }),
  })
  if (res.status === 401) {
    return { text: 'Sessione JBA non valida: scollega e ricollega l\'account Telegram dalle Impostazioni.', isError: true }
  }
  const reply = (await res.json().catch(() => null)) as ToolCallReply | null
  if (!reply) return { text: `Risposta non leggibile da JBA (HTTP ${res.status}).`, isError: true }
  if (reply.error) return { text: reply.error.message ?? 'Errore JBA', isError: true }
  const text = (reply.result?.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
  return { text: text || '(nessun contenuto)', isError: reply.result?.isError === true }
}
