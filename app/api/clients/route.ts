import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/tracking/activity'
import type { ClientLifecycleStage } from '@/lib/types/client'

const VALID_STAGES: ClientLifecycleStage[] = ['prospect', 'active', 'churned', 'archived']

// GET /api/clients — list clients for the current user
// Optional query param ?stage=prospect|active|churned|archived filters by lifecycle_stage
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const stageParam = searchParams.get('stage')

  // Access to each client is enforced by RLS via client_members so that
  // clients the user has been shared on (editor/viewer) also appear here.
  let query = supabase
    .from('clients')
    .select('*')
    .order('updated_at', { ascending: false })

  if (stageParam) {
    if (!VALID_STAGES.includes(stageParam as ClientLifecycleStage)) {
      return NextResponse.json(
        { error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` },
        { status: 400 }
      )
    }
    query = query.eq('lifecycle_stage', stageParam)
  }

  const { data: clients, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enrich with analysis stats. Previously this fired 2 queries per client
  // (count + latest) — an N+1 that scaled with the client list. Instead pull
  // every completed analysis for the whole list in ONE query (newest-first)
  // and fold the per-client count + latest in memory.
  const clientIds = (clients || []).map((c) => c.id)
  const statsByClient = new Map<
    string,
    { count: number; latest_score: number | null; latest_analysis_at: string | null }
  >()

  if (clientIds.length > 0) {
    const { data: analyses } = await supabase
      .from('analyses')
      .select('client_id, overall_score, completed_at')
      .in('client_id', clientIds)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })

    for (const a of analyses || []) {
      const cur = statsByClient.get(a.client_id)
      if (!cur) {
        // First row for this client = its latest completed analysis.
        statsByClient.set(a.client_id, {
          count: 1,
          latest_score: a.overall_score ?? null,
          latest_analysis_at: a.completed_at ?? null,
        })
      } else {
        cur.count += 1
      }
    }
  }

  const enriched = (clients || []).map((client) => {
    const stats = statsByClient.get(client.id)
    return {
      ...client,
      analyses_count: stats?.count ?? 0,
      latest_score: stats?.latest_score ?? null,
      latest_analysis_at: stats?.latest_analysis_at ?? null,
    }
  })

  return NextResponse.json({ clients: enriched })
}

// POST /api/clients — create a new client
// Accepts optional `lifecycle_stage` (default 'prospect') and seeds a client_members
// row with the creator as 'owner'.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()
  const {
    name,
    domain,
    industry,
    website_url,
    contact_name,
    contact_email,
    contact_phone,
    notes,
    lifecycle_stage,
    pre_sales_notes,
  } = body

  if (!name || name.trim().length === 0) {
    return NextResponse.json({ error: 'Client name is required' }, { status: 400 })
  }

  // Validate lifecycle_stage if provided, default to 'prospect'
  let stage: ClientLifecycleStage = 'prospect'
  if (lifecycle_stage !== undefined) {
    if (!VALID_STAGES.includes(lifecycle_stage)) {
      return NextResponse.json(
        { error: `Invalid lifecycle_stage. Must be one of: ${VALID_STAGES.join(', ')}` },
        { status: 400 }
      )
    }
    stage = lifecycle_stage
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
      lifecycle_stage: stage,
      pre_sales_notes: pre_sales_notes?.trim() || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Best-effort: seed client_members with the creator as 'owner'.
  // Supabase does not support real transactions from the client SDK; if this
  // insert fails we log and continue so the client is still usable by its
  // creator (the existing clients.user_id RLS still applies).
  if (client) {
    const { error: memberError } = await supabase
      .from('client_members')
      .insert({
        client_id: client.id,
        user_id: user.id,
        role: 'owner',
        added_by: user.id,
      })

    if (memberError) {
      console.error(
        '[api/clients POST] Failed to seed client_members owner row for',
        client.id,
        memberError
      )
    }

    // Log activity (non-blocking)
    logActivity({
      userId: user.id,
      action: 'create_client',
      resourceType: 'client',
      resourceId: client.id,
      details: {
        name: client.name,
        domain: client.domain,
        lifecycle_stage: stage,
      },
    }).catch(() => {})
  }

  return NextResponse.json({ client }, { status: 201 })
}
