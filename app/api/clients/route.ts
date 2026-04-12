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

  let query = supabase
    .from('clients')
    .select('*')
    .eq('user_id', user.id)
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
