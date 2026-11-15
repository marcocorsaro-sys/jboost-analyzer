/**
 * Telegram bot — persistence (service role; tables have RLS on and no policies).
 */

import { createHash, randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Message, ToolResultBlock } from '@/lib/telegram/agent'
import { LINK_CODE_TTL_MINUTES, makeLinkCode } from '@/lib/telegram/text'

export interface TelegramLink {
  telegram_user_id: number
  chat_id: number
  user_id: string
  email: string | null
  history: Message[]
}

export const PENDING_TTL_MINUTES = 15

export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export async function claimUpdate(updateId: number): Promise<boolean> {
  const { error } = await createAdminClient().from('telegram_updates').insert({ update_id: updateId })
  return !error
}

export async function getLink(telegramUserId: number): Promise<TelegramLink | null> {
  const { data } = await createAdminClient()
    .from('telegram_links')
    .select('telegram_user_id, chat_id, user_id, email, history')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle()
  if (!data) return null
  return { ...(data as TelegramLink), history: Array.isArray(data.history) ? (data.history as Message[]) : [] }
}

export async function saveHistory(telegramUserId: number, history: Message[]): Promise<void> {
  await createAdminClient().from('telegram_links').update({ history }).eq('telegram_user_id', telegramUserId)
}

export async function deleteLink(telegramUserId: number): Promise<void> {
  const admin = createAdminClient()
  await admin.from('telegram_pending').delete().eq('telegram_user_id', telegramUserId)
  await admin.from('telegram_links').delete().eq('telegram_user_id', telegramUserId)
}

/** Code shown once to a signed-in user (stored hashed, single use, short TTL). */
export async function createLinkCode(userId: string, email: string | null): Promise<{ code: string; expiresAt: string }> {
  const admin = createAdminClient()
  const code = makeLinkCode(randomBytes(8))
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60_000).toISOString()
  await admin.from('telegram_link_codes').delete().eq('user_id', userId)
  const { error } = await admin.from('telegram_link_codes').insert({ code_hash: hashCode(code), user_id: userId, email, expires_at: expiresAt })
  if (error) throw new Error(error.message)
  return { code, expiresAt }
}

/** Consume a code (single use). Null = unknown or expired. */
export async function consumeLinkCode(code: string): Promise<{ user_id: string; email: string | null } | null> {
  const admin = createAdminClient()
  const hash = hashCode(code)
  const { data } = await admin
    .from('telegram_link_codes')
    .select('user_id, email, expires_at')
    .eq('code_hash', hash)
    .maybeSingle()
  if (!data) return null
  // Delete first: a code can never be used twice, even on a race.
  const { data: deleted } = await admin.from('telegram_link_codes').delete().eq('code_hash', hash).select('code_hash')
  if (!deleted || deleted.length === 0) return null
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null
  return { user_id: data.user_id as string, email: (data.email as string | null) ?? null }
}

export async function upsertLink(params: { telegramUserId: number; chatId: number; userId: string; email: string | null }): Promise<void> {
  const admin = createAdminClient()
  // One JBA user = one Telegram account: a new link replaces the old one.
  await admin.from('telegram_links').delete().eq('user_id', params.userId)
  const { error } = await admin.from('telegram_links').upsert({
    telegram_user_id: params.telegramUserId,
    chat_id: params.chatId,
    user_id: params.userId,
    email: params.email,
    history: [],
  })
  if (error) throw new Error(error.message)
}

export interface PendingAction {
  id: string
  telegram_user_id: number
  tool: string
  tool_use_id: string
  args: unknown
  messages: Message[]
  partialResults: ToolResultBlock[]
}

export async function savePending(params: {
  telegramUserId: number
  tool: string
  toolUseId: string
  args: unknown
  messages: Message[]
  partialResults: ToolResultBlock[]
  summary: string
}): Promise<string> {
  const admin = createAdminClient()
  // Only one open confirmation per person: a new request replaces the old.
  await admin.from('telegram_pending').delete().eq('telegram_user_id', params.telegramUserId)
  const { data, error } = await admin
    .from('telegram_pending')
    .insert({
      telegram_user_id: params.telegramUserId,
      tool: params.tool,
      tool_use_id: params.toolUseId,
      args: params.args ?? {},
      messages: { messages: params.messages, partialResults: params.partialResults },
      summary: params.summary,
      expires_at: new Date(Date.now() + PENDING_TTL_MINUTES * 60_000).toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'pending not saved')
  return data.id as string
}

/** Take (and delete) a pending action that belongs to THIS Telegram user and is not expired. */
export async function takePending(id: string, telegramUserId: number): Promise<PendingAction | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('telegram_pending')
    .delete()
    .eq('id', id)
    .eq('telegram_user_id', telegramUserId)
    .select('id, telegram_user_id, tool, tool_use_id, args, messages, expires_at')
  const row = data?.[0]
  if (!row) return null
  if (new Date(row.expires_at as string).getTime() < Date.now()) return null
  const stored = row.messages as { messages?: Message[]; partialResults?: ToolResultBlock[] } | null
  return {
    id: row.id as string,
    telegram_user_id: row.telegram_user_id as number,
    tool: row.tool as string,
    tool_use_id: row.tool_use_id as string,
    args: row.args,
    messages: stored?.messages ?? [],
    partialResults: stored?.partialResults ?? [],
  }
}
