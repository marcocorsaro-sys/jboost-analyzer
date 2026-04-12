import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { runMonitoringForClient } from '@/lib/monitoring/run'
import { logActivity } from '@/lib/tracking/activity'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/clients/[id]/monitoring/run-now
//
// On-demand monitoring run. Mostly used by the "Run now" button in the
// monitoring panel. Authorization is enforced by RLS on analyses + client
// tables — only editor+ members can insert into analyses for that client.
//
// The same helper used by the cron orchestrator drives the actual work, so
// the manual path and the scheduled path produce identical analyses rows
// (source='monitoring').
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const result = await runMonitoringForClient(supabase, params.id)
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  logActivity({
    userId: user.id,
    action: 'monitoring_run_now',
    resourceType: 'client',
    resourceId: params.id,
    details: { analysis_id: result.analysisId },
  }).catch(() => {})

  return NextResponse.json({
    success: true,
    analysisId: result.analysisId,
  })
}
