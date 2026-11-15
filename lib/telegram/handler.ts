/**
 * Telegram bot — one incoming update, end to end.
 *
 * Only private chats. Only people who linked their Telegram account to their
 * JBA login (code generated in Settings while signed in). Everything the
 * person asks goes to the agent, which uses the same tools as the Claude
 * connector under that person's own session; write tools wait for a button.
 */

import {
  answerCallback,
  clearButtons,
  sendText,
  sendTyping,
  type TelegramUpdate,
} from '@/lib/telegram/api'
import { resumeAfterConfirm, runAgent, trimHistory, type AgentDeps, type AgentOutcome, type Message } from '@/lib/telegram/agent'
import { callBotModel } from '@/lib/telegram/llm'
import { botTools, callJbaTool } from '@/lib/telegram/mcp-client'
import { mintAccessToken } from '@/lib/telegram/session'
import {
  claimUpdate,
  consumeLinkCode,
  deleteLink,
  getLink,
  savePending,
  saveHistory,
  takePending,
  upsertLink,
  type TelegramLink,
} from '@/lib/telegram/store'
import { describeArgs, parseCommand } from '@/lib/telegram/text'

const HELP = [
  'Sono l\'assistente di J-Boost Analyzer. Scrivimi in italiano quello che ti serve, per esempio:',
  '- elenco degli audit e del loro stato',
  '- punteggi e dettaglio di un driver di JBA-0020',
  '- gli insights scritti di un audit',
  '- creare e avviare un audit, rilanciare un driver, generare gli insights',
  '',
  'Le azioni che modificano dati o consumano API a pagamento partono solo dopo la tua conferma con un pulsante.',
  '',
  'Comandi: /nuovo (riparti da zero), /annulla (annulla l\'azione in attesa), /scollega, /aiuto',
].join('\n')

const NOT_LINKED = [
  'Per usare JBA da qui devo sapere chi sei.',
  '1. Accedi a J-Boost Analyzer, apri Impostazioni, sezione Telegram, e genera il codice.',
  '2. Scrivimi qui: /collega CODICE',
  'Il codice vale 10 minuti e si usa una volta sola.',
].join('\n')

function origin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jboost-analyzer.vercel.app').trim().replace(/\/$/, '')
}

export async function handleUpdate(update: TelegramUpdate, requestOrigin?: string): Promise<void> {
  if (!(await claimUpdate(update.update_id))) return // Telegram retry: already handled
  const base = (requestOrigin ?? origin()).replace(/\/$/, '')

  if (update.callback_query) return handleCallback(update.callback_query, base)

  const msg = update.message
  if (!msg || !msg.from || msg.from.is_bot || msg.chat.type !== 'private') return
  if (typeof msg.text !== 'string' || msg.text.trim() === '') {
    await sendText(msg.chat.id, 'Per ora leggo solo messaggi di testo.')
    return
  }

  const chatId = msg.chat.id
  const userId = msg.from.id
  const command = parseCommand(msg.text)

  if (command.kind === 'start' || command.kind === 'help') {
    const link = await getLink(userId)
    await sendText(chatId, link ? HELP : NOT_LINKED)
    return
  }

  if (command.kind === 'link') {
    if (!command.code) {
      await sendText(chatId, 'Codice non valido. Genera un nuovo codice dalle Impostazioni di JBA e scrivi: /collega CODICE')
      return
    }
    const found = await consumeLinkCode(command.code)
    if (!found) {
      await sendText(chatId, 'Codice scaduto o già usato. Generane uno nuovo dalle Impostazioni di JBA.')
      return
    }
    await upsertLink({ telegramUserId: userId, chatId, userId: found.user_id, email: found.email })
    await sendText(chatId, `Collegato${found.email ? ` come ${found.email}` : ''}. Ora puoi chiedermi quello che ti serve su JBA.\n\n${HELP}`)
    return
  }

  const link = await getLink(userId)
  if (!link) {
    await sendText(chatId, NOT_LINKED)
    return
  }

  switch (command.kind) {
    case 'unlink':
      await deleteLink(userId)
      await sendText(chatId, 'Scollegato. Per riusare il bot devi rifare il collegamento dalle Impostazioni di JBA.')
      return
    case 'reset':
      await saveHistory(userId, [])
      await sendText(chatId, 'Conversazione azzerata.')
      return
    case 'cancel': {
      await takePendingAll(userId)
      await sendText(chatId, 'Nessuna azione in attesa.')
      return
    }
    case 'text':
      await converse(link, chatId, command.text, base)
      return
  }
}

async function takePendingAll(telegramUserId: number): Promise<void> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  await createAdminClient().from('telegram_pending').delete().eq('telegram_user_id', telegramUserId)
}

/** Deps bound to one person: their token, their tools. A token that cannot be minted stops everything. */
async function depsFor(link: TelegramLink, base: string): Promise<AgentDeps | null> {
  if (!link.email) return null
  const token = await mintAccessToken(link.email)
  if (!token) return null
  return {
    llm: callBotModel,
    runTool: (name, args) => callJbaTool(base, token, name, args),
  }
}

async function converse(link: TelegramLink, chatId: number, text: string, base: string): Promise<void> {
  await sendTyping(chatId)
  const deps = await depsFor(link, base)
  if (!deps) {
    await sendText(chatId, 'Non riesco ad accedere a JBA con il tuo account. Scollega (/scollega) e ricollega dalle Impostazioni.')
    return
  }
  const history = trimHistory(link.history)
  const messages: Message[] = [...history, { role: 'user', content: text }]
  let outcome: AgentOutcome
  try {
    outcome = await runAgent(messages, botTools(), deps)
  } catch (err) {
    await sendText(chatId, `Errore: ${err instanceof Error ? err.message : 'richiesta non riuscita'}.`)
    return
  }
  await deliver(link, chatId, outcome)
}

async function deliver(link: TelegramLink, chatId: number, outcome: AgentOutcome): Promise<void> {
  if (outcome.type === 'reply') {
    await sendText(chatId, outcome.text)
    // Tool traffic is not kept: only the text turns (trimHistory drops the rest).
    await saveHistory(link.telegram_user_id, trimHistory([...outcome.messages, { role: 'assistant', content: outcome.text }]))
    return
  }
  const argsText = describeArgs(outcome.args)
  const summary = `Confermi questa azione su JBA?\n\n${outcome.tool}${argsText ? `\n${argsText}` : ''}`
  const id = await savePending({
    telegramUserId: link.telegram_user_id,
    tool: outcome.tool,
    toolUseId: outcome.toolUseId,
    args: outcome.args,
    messages: outcome.messages,
    partialResults: outcome.partialResults,
    summary,
  })
  await sendText(chatId, summary, [
    { text: 'Conferma', callback_data: `ok:${id}` },
    { text: 'Annulla', callback_data: `no:${id}` },
  ])
}

async function handleCallback(cb: NonNullable<TelegramUpdate['callback_query']>, base: string): Promise<void> {
  const chat = cb.message?.chat
  if (!chat || chat.type !== 'private' || !cb.data) {
    await answerCallback(cb.id)
    return
  }
  const [verb, id] = cb.data.split(':')
  if ((verb !== 'ok' && verb !== 'no') || !id) {
    await answerCallback(cb.id)
    return
  }
  const link = await getLink(cb.from.id)
  if (!link) {
    await answerCallback(cb.id, 'Account non collegato')
    return
  }
  if (cb.message) await clearButtons(chat.id, cb.message.message_id)

  const pending = await takePending(id, cb.from.id)
  if (!pending) {
    await answerCallback(cb.id, 'Azione scaduta o già gestita')
    await sendText(chat.id, 'Questa azione è scaduta o è già stata gestita. Richiedila di nuovo.')
    return
  }
  if (verb === 'no') {
    await answerCallback(cb.id, 'Annullata')
    await sendText(chat.id, 'Annullato. Non ho eseguito nulla.')
    return
  }

  await answerCallback(cb.id, 'Eseguo…')
  await sendTyping(chat.id)
  const deps = await depsFor(link, base)
  if (!deps) {
    await sendText(chat.id, 'Non riesco ad accedere a JBA con il tuo account. Scollega (/scollega) e ricollega dalle Impostazioni.')
    return
  }
  let outcome: AgentOutcome
  try {
    outcome = await resumeAfterConfirm({ ...pending, toolUseId: pending.tool_use_id }, botTools(), deps)
  } catch (err) {
    await sendText(chat.id, `Errore: ${err instanceof Error ? err.message : 'esecuzione non riuscita'}.`)
    return
  }
  await deliver(link, chat.id, outcome)
}

