/**
 * Link between a signed-in JBA user and their Telegram account.
 * GET    → { linked, email, bot }
 * POST   → a one-time code (10 minutes) to send to the bot as /collega CODE
 * DELETE → unlink
 * Cookie session only (the web app's own login): the code proves the person
 * who asks for it is signed in to JBA.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createLinkCode } from '@/lib/telegram/store'
import { LINK_CODE_TTL_MINUTES } from '@/lib/telegram/text'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BOT = () => (process.env.TELEGRAM_BOT_USERNAME ?? 'Jboostanalyser_bot').replace(/^@/, '')

async function currentUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return data.user
}

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data } = await createAdminClient().from('telegram_links').select('telegram_user_id').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ linked: !!data, email: user.email ?? null, bot: BOT() })
}

export async function POST() {
  const user = await currentUser()
  if (!user || !user.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { code, expiresAt } = await createLinkCode(user.id, user.email)
    return NextResponse.json({ code, expiresAt, ttlMinutes: LINK_CODE_TTL_MINUTES, bot: BOT() })
  } catch {
    return NextResponse.json({ error: 'code_not_created' }, { status: 500 })
  }
}

export async function DELETE() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin.from('telegram_links').select('telegram_user_id').eq('user_id', user.id)
  for (const row of data ?? []) {
    await admin.from('telegram_pending').delete().eq('telegram_user_id', row.telegram_user_id)
  }
  await admin.from('telegram_links').delete().eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
