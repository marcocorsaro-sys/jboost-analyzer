export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/tracking/activity'
import {
  buildClientRowFromAudit,
  linkedClientId,
  stampPromotion,
  type PromotableAnalysis,
} from '@/lib/v4/promote'

/**
 * POST /api/v4/analyses/[id]/promote — "Switch to client".
 *
 * The single onboarding mechanic of V4: a prospect enters through the
 * New-audit wizard, and this route is how the audit BECOMES a client
 * (UX-UI Bibbia 04: "open the analysis or promote ('switch to client')").
 *
 * What it does, in order:
 *   1. RLS check through the user-scoped client, like every sibling
 *      /api/v4 route: no analyses row visible, no promotion.
 *   2. Preconditions: the row must be a V4 audit (ref_date set — the same
 *      discriminator lib/v4/audits uses) and must not already be tied to a
 *      client (previous promotion in v4_setup.promoted_client_id, or a
 *      client_id chosen in the wizard) → 409 with the linked clientId so the
 *      UI can deep-link instead of failing dumbly.
 *   3. Creates the `clients` row from the audit's setup data via the
 *      USER-scoped client (clients_insert RLS: user_id = auth.uid()); the
 *      phase4a trigger registers the creator as 'owner' in client_members,
 *      and — V1 POST /api/clients pattern — we also seed the membership
 *      best-effort in case the trigger is missing in an environment.
 *   4. Links the audit: analyses.client_id = new client, and the promotion
 *      stamp (promoted_client_id + promoted_at) goes into v4_setup — no
 *      migration, the jsonb column already exists. The UPDATE is conditional
 *      on client_id still being NULL so a concurrent double-click cannot
 *      produce two clients silently: the loser rolls its orphan row back
 *      and reports 409.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: analysis, error: fetchError } = await supabase
    .from('analyses')
    .select('id, domain, brand_name, ref_date, client_id, industry_preset, v4_setup')
    .eq('id', analysisId)
    .maybeSingle()
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 })
  }

  const a = analysis as unknown as PromotableAnalysis
  if (!a.ref_date) {
    // V1 analyses have their own lifecycle (/pre-sales promote); this
    // mechanic is the V4 one.
    return NextResponse.json({ error: 'not a V4 audit' }, { status: 400 })
  }

  const alreadyLinked = linkedClientId(a)
  if (alreadyLinked) {
    return NextResponse.json(
      { error: 'audit già promosso a cliente', clientId: alreadyLinked },
      { status: 409 },
    )
  }

  const built = buildClientRowFromAudit(a, user.id)
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 })
  }

  // 3. Create the client as the user (RLS + auto-owner trigger apply).
  const { data: client, error: insertError } = await supabase
    .from('clients')
    .insert(built.row)
    .select('id, name')
    .single()
  if (insertError || !client) {
    return NextResponse.json(
      { error: `could not create the client: ${insertError?.message ?? 'unknown'}` },
      { status: 500 },
    )
  }

  // Best-effort owner membership (V1 pattern; the phase4a trigger normally
  // already did this — ON CONFLICT DO NOTHING semantics via upsert).
  const { error: memberError } = await supabase
    .from('client_members')
    .upsert(
      { client_id: client.id, user_id: user.id, role: 'owner', added_by: user.id },
      { onConflict: 'client_id,user_id', ignoreDuplicates: true },
    )
  if (memberError) {
    console.error('[v4 promote] client_members seed failed for', client.id, memberError)
  }

  // 4. Link the audit — conditional claim so a concurrent promotion loses
  //    loudly instead of leaving two clients behind.
  const db = createAdminClient()
  const { data: linked, error: linkError } = await db
    .from('analyses')
    .update({
      client_id: client.id,
      v4_setup: stampPromotion(a.v4_setup, client.id),
    })
    .eq('id', analysisId)
    .is('client_id', null)
    .select('id')
  if (linkError || !linked || linked.length === 0) {
    // Roll the orphan client back (best-effort) and report the conflict.
    await supabase.from('clients').delete().eq('id', client.id)
    if (linkError) {
      return NextResponse.json(
        { error: `could not link the audit: ${linkError.message}` },
        { status: 500 },
      )
    }
    const { data: current } = await supabase
      .from('analyses')
      .select('client_id, v4_setup')
      .eq('id', analysisId)
      .maybeSingle()
    return NextResponse.json(
      {
        error: 'audit già promosso a cliente',
        clientId: current
          ? linkedClientId(current as { client_id: string | null; v4_setup: Record<string, unknown> | null })
          : null,
      },
      { status: 409 },
    )
  }

  logActivity({
    userId: user.id,
    action: 'promote_audit_to_client',
    resourceType: 'client',
    resourceId: client.id,
    details: { analysis_id: analysisId, name: client.name, domain: a.domain },
  }).catch(() => {})

  return NextResponse.json(
    { clientId: client.id, name: client.name },
    { status: 201 },
  )
}
