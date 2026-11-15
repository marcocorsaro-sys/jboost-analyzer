/**
 * Telegram bot — model call (Anthropic Messages API with tool use).
 * Key: ANTHROPIC_API_KEY (already used by the app). Model: TELEGRAM_BOT_MODEL,
 * default claude-sonnet-5 (same family the V4 extraction uses).
 */

import { SERVER_INSTRUCTIONS } from '@/lib/mcp/jsonrpc'
import type { AgentTool, LlmTurn, Message } from '@/lib/telegram/agent'

export const DEFAULT_BOT_MODEL = 'claude-sonnet-5'

export const BOT_SYSTEM_PROMPT = [
  'Sei l\'assistente di J-Boost Analyzer (JBA) su Telegram, per il team Jakala. Rispondi in italiano, breve e diretto.',
  'Usi gli stessi strumenti del connettore Claude: coprono tutto ciò che JBA fa (clienti, audit, driver, insights, controller, decisioni, note, pubblicazione).',
  SERVER_INSTRUCTIONS,
  'Telegram mostra testo semplice: niente markdown, niente tabelle, niente titoli o parole in maiuscolo. Elenchi brevi con un trattino per riga, solo se servono.',
  'I numeri sono quelli restituiti dagli strumenti, citati così come sono. Un dato mancante o un driver in errore lo dici chiaramente, non lo sostituisci con una stima.',
  'Gli audit si indicano con il codice progetto (JBA-0020). Se l\'utente non lo dà e il riferimento è ambiguo, usa list_audits e chiedi quale.',
  'Gli strumenti che modificano dati o consumano API a pagamento non partono subito: l\'utente riceve un riepilogo con pulsanti Conferma/Annulla. Richiedi lo strumento solo quando l\'utente ha chiesto quell\'azione, con tutti i parametri necessari; se ne manca uno, chiedilo.',
  'Non inventare siti, competitor, punteggi o audit. Se non sai, interroga lo strumento giusto o dillo.',
].join('\n')

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>
  error?: { message?: string }
}

export async function callBotModel(params: { messages: Message[]; tools: AgentTool[] }): Promise<LlmTurn> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurata')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.TELEGRAM_BOT_MODEL?.trim() || DEFAULT_BOT_MODEL,
      max_tokens: 2048,
      system: BOT_SYSTEM_PROMPT,
      messages: params.messages,
      tools: params.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
    }),
  })
  const data = (await res.json().catch(() => ({}))) as AnthropicResponse
  if (!res.ok) throw new Error(`Modello non raggiungibile: HTTP ${res.status} ${data.error?.message ?? ''}`.trim())

  const content: LlmTurn['content'] = []
  for (const block of data.content ?? []) {
    if (block.type === 'text' && typeof block.text === 'string') content.push({ type: 'text', text: block.text })
    else if (block.type === 'tool_use' && block.id && block.name) {
      content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} })
    }
  }
  return { content }
}
