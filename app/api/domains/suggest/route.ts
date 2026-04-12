import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const COMMON_TLDS = ['.com', '.it', '.co.uk', '.org']

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() || ''
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || '8'), 20)

    if (!q || q.length < 2) {
      return NextResponse.json({ clients: [], suggestions: [] })
    }

    // 1. Search client domains matching the query (any non-archived client,
    //    including prospects — useful when entering a domain in the analyzer).
    const { data: clientRows } = await supabase
      .from('clients')
      .select('domain')
      .eq('user_id', user.id)
      .neq('status', 'archived')
      .not('domain', 'is', null)
      .ilike('domain', `%${q}%`)
      .limit(5)

    const clientDomains = (clientRows || [])
      .map(r => r.domain as string)
      .filter(Boolean)

    // 2. Search previous analysis domains
    const { data: analysisRows } = await supabase
      .from('analyses')
      .select('domain')
      .eq('user_id', user.id)
      .ilike('domain', `%${q}%`)
      .order('completed_at', { ascending: false })
      .limit(10)

    // Merge unique domains from analyses not already in clients
    const analysisDomains = (analysisRows || [])
      .map(r => r.domain as string)
      .filter(d => d && !clientDomains.includes(d))

    // Deduplicate and combine
    const uniqueSet = new Set([...clientDomains, ...analysisDomains])
    const allClientDomains = Array.from(uniqueSet).slice(0, limit)

    // 3. Generate TLD suggestions if query doesn't contain a dot
    const suggestions: string[] = []
    if (!q.includes('.') && q.length >= 3) {
      for (const tld of COMMON_TLDS) {
        const suggestion = q + tld
        if (!allClientDomains.includes(suggestion)) {
          suggestions.push(suggestion)
        }
      }
    }

    return NextResponse.json({
      clients: allClientDomains,
      suggestions: suggestions.slice(0, 4),
    })
  } catch (err) {
    console.error('[Domain Suggest] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
