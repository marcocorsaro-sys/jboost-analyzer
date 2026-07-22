/**
 * GET /api/spend-status — return today's LLM spend versus the configured
 * daily limit. Used by the dashboard banner to surface warnings + hard blocks
 * without polling the heavy /api/admin/costs endpoint.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSpendStatus } from '@/lib/tracking/spend-limit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const status = await getSpendStatus(supabase)
  return NextResponse.json({ status })
}
