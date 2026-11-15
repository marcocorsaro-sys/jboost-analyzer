/**
 * Telegram Bot API — minimal client. The token is read from TELEGRAM_BOT_TOKEN
 * (server env only); it is never logged and never placed in a response.
 */

import { splitMessage } from '@/lib/telegram/text'

export interface InlineButton {
  text: string
  callback_data: string
}

function endpoint(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured')
  return `https://api.telegram.org/bot${token}/${method}`
}

async function call(method: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(endpoint(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // Never include the URL (it carries the token).
    const text = await res.text().catch(() => '')
    throw new Error(`Telegram ${method} failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
}

/** Plain text on purpose (no parse_mode): model output can never break the formatting. */
export async function sendText(chatId: number, text: string, buttons?: InlineButton[]): Promise<void> {
  const parts = splitMessage(text)
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1
    await call('sendMessage', {
      chat_id: chatId,
      text: parts[i],
      disable_web_page_preview: true,
      ...(last && buttons && buttons.length > 0 ? { reply_markup: { inline_keyboard: [buttons] } } : {}),
    })
  }
}

export async function sendTyping(chatId: number): Promise<void> {
  try {
    await call('sendChatAction', { chat_id: chatId, action: 'typing' })
  } catch {
    // cosmetic
  }
}

export async function answerCallback(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) })
  } catch {
    // cosmetic
  }
}

/** Remove the buttons of a message once decided (best effort). */
export async function clearButtons(chatId: number, messageId: number): Promise<void> {
  try {
    await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
  } catch {
    // cosmetic
  }
}

// ---------------------------------------------------------------------------
// Incoming update (only the fields we read)
// ---------------------------------------------------------------------------

export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    text?: string
    chat: { id: number; type: string }
    from?: { id: number; is_bot?: boolean }
  }
  callback_query?: {
    id: string
    data?: string
    from: { id: number }
    message?: { message_id: number; chat: { id: number; type: string } }
  }
}
