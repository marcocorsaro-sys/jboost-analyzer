/**
 * Telegram bot — the agent loop (pure: the model call and the tool runner are
 * injected, so it is testable without network).
 *
 * The model sees the SAME tools as the Claude connector. Read tools run at
 * once. A write tool (changes data or spends paid API units) never runs on
 * the model's say-so: the loop stops and returns a `confirm` outcome, the user
 * presses a button, and only then the tool runs (resume()).
 */

export interface AgentTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
}

export type TextBlock = { type: 'text'; text: string }
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown }
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export type Block = TextBlock | ToolUseBlock | ToolResultBlock
export interface Message {
  role: 'user' | 'assistant'
  content: string | Block[]
}

export interface LlmTurn {
  content: Array<TextBlock | ToolUseBlock>
}

export interface AgentDeps {
  llm(params: { messages: Message[]; tools: AgentTool[] }): Promise<LlmTurn>
  runTool(name: string, args: unknown): Promise<{ text: string; isError: boolean }>
}

export type AgentOutcome =
  | { type: 'reply'; text: string; messages: Message[] }
  | {
      type: 'confirm'
      tool: string
      args: unknown
      toolUseId: string
      /** Conversation up to and including the assistant message that asked for the tool. */
      messages: Message[]
      /** Results already obtained for the other tool calls of that same assistant message. */
      partialResults: ToolResultBlock[]
    }

export const MAX_STEPS = 8
export const MAX_TOOL_RESULT_CHARS = 12000

function clip(text: string): string {
  return text.length <= MAX_TOOL_RESULT_CHARS ? text : `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[risposta troncata]`
}

function textOf(blocks: Array<TextBlock | ToolUseBlock>): string {
  return blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

export async function runAgent(messages: Message[], tools: AgentTool[], deps: AgentDeps): Promise<AgentOutcome> {
  const writeTools = new Set(tools.filter((t) => !t.readOnly).map((t) => t.name))
  const convo: Message[] = [...messages]

  for (let step = 0; step < MAX_STEPS; step++) {
    const turn = await deps.llm({ messages: convo, tools })
    convo.push({ role: 'assistant', content: turn.content })

    const uses = turn.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
    if (uses.length === 0) {
      return { type: 'reply', text: textOf(turn.content) || 'Non ho nulla da aggiungere.', messages: convo }
    }

    const results: ToolResultBlock[] = []
    let pending: ToolUseBlock | null = null
    for (const use of uses) {
      if (writeTools.has(use.name)) {
        if (pending === null) {
          pending = use
        } else {
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: true,
            content: 'Non eseguita: una sola azione che modifica dati per volta. Va richiesta dopo la conferma della precedente.',
          })
        }
        continue
      }
      const out = await deps.runTool(use.name, use.input)
      results.push({ type: 'tool_result', tool_use_id: use.id, content: clip(out.text), ...(out.isError ? { is_error: true } : {}) })
    }

    if (pending) {
      return { type: 'confirm', tool: pending.name, args: pending.input, toolUseId: pending.id, messages: convo, partialResults: results }
    }
    convo.push({ role: 'user', content: results })
  }

  return {
    type: 'reply',
    text: 'Ho fatto troppi passaggi senza arrivare a una risposta. Riformula la richiesta in modo più specifico.',
    messages: convo,
  }
}

/** The user confirmed: run the pending write tool, then let the model close the turn. */
export async function resumeAfterConfirm(
  pending: { tool: string; args: unknown; toolUseId: string; messages: Message[]; partialResults: ToolResultBlock[] },
  tools: AgentTool[],
  deps: AgentDeps,
): Promise<AgentOutcome> {
  const out = await deps.runTool(pending.tool, pending.args)
  const result: ToolResultBlock = {
    type: 'tool_result',
    tool_use_id: pending.toolUseId,
    content: clip(out.text),
    ...(out.isError ? { is_error: true } : {}),
  }
  const messages: Message[] = [...pending.messages, { role: 'user', content: [...pending.partialResults, result] }]
  return runAgent(messages, tools, deps)
}

/** Text-only history kept between turns (tool traffic is not persisted). */
export const HISTORY_LIMIT = 12

export function trimHistory(history: Message[]): Message[] {
  const textual = history.filter((m) => typeof m.content === 'string')
  const tail = textual.slice(-HISTORY_LIMIT)
  // The API requires the first message to be from the user.
  while (tail.length > 0 && tail[0].role !== 'user') tail.shift()
  return tail
}
