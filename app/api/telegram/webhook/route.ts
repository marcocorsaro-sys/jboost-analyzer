/**
 * Telegram webhook (@Jboostanalyser_bot).
 *
 * Telegram sends the secret chosen at setWebhook time in
 * X-Telegram-Bot-Api-Secret-Token; anything without it is rejected, so only
 * Telegram can reach the handler. The update is processed before answering
 * (a serverless function stops once it responds); a retry of the same
 * update_id is ignored by the handler.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { originFromHeaders } from '@/lib/mcp/auth'
import type { TelegramUpdate } from '@/lib/telegram/api'
import { handleUpdate } from '@/lib/telegram/handler'
import { safeEqual } from '@/lib/telegram/text'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET
  const received = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (!expected || !safeEqual(received, expected)) {
    return new NextResponse(null, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  if (typeof update?.update_id !== 'number') return new NextResponse(null, { status: 400 })

  try {
    await handleUpdate(update, originFromHeaders(request.headers, request.url))
  } catch (err) {
    // Always 200: a 5xx makes Telegram retry the same update for hours.
    console.error('[telegram] update failed', err instanceof Error ? err.message : err)
  }
  return NextResponse.json({ ok: true })
}
