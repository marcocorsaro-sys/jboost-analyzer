import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'

// GET /api/clients — list all clients for the current user
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Fetch clients with latest analysis stats
  const { data: clients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enrich with analysis stats
  const enriched = await Promise.all(
    (clients || []).map(async (client) => {
      const { count } = await supabase
        .from('analyses')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .eq('status', 'completed')

      const { data: latest } = await supabase
        .from('analyses')
        .select('overall_score, completed_at')
        .eq('client_id', client.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .single()

      return {
        ...client,
        analyses_count: count ?? 0,
        latest_score: latest?.overall_score ?? null,
        latest_analysis_at: latest?.completed_at ?? null,
      }
    })
  )

  return NextResponse.json({ clients: enriched })
}

// POST /api/clients — create a new client
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()
  const { name, domain, industry, website_url, contact_name, contact_email, contact_phone, notes } = body

  if (!name || name.trim().length === 0) {
    return NextResponse.json({ error: 'Client name is required' }, { status: 400 })
  }

  // Clean domain
  let cleanDomain = domain?.trim() || null
  if (cleanDomain) {
    cleanDomain = cleanDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
  }

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      user_id: user.id,
      name: name.trim(),
      domain: cleanDomain,
      industry: industry?.trim() || null,
      website_url: website_url?.trim() || (cleanDomain ? `https://${cleanDomain}` : null),
      contact_name: contact_name?.trim() || null,
      contact_email: contact_email?.trim() || null,
      contact_phone: contact_phone?.trim() || null,
      notes: notes?.trim() || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log activity (non-blocking)
  if (client) {
    logActivity({
      userId: user.id,
      action: 'create_client',
      resourceType: 'client',
      resourceId: client.id,
      details: { name: client.name, domain: client.domain },
    }).catch(() => {})
  }

  return NextResponse.json({ client }, { status: 201 })
}
