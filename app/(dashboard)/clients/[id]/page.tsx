import { createClient, getUser, getClientById, getProfileRole } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getScoreBand } from '@/lib/constants'
import { calcDelta } from '@/lib/trends/calculate'
import Link from 'next/link'
import ClientOverviewTrend from '@/components/clients/ClientOverviewTrend'
import LifecycleActions from '@/components/clients/LifecycleActions'
import MonitoringPanel from '@/components/clients/MonitoringPanel'
import MonitoringLockedCard from '@/components/clients/MonitoringLockedCard'
import TeamPanel from '@/components/clients/TeamPanel'
import MemoryMainCard from '@/components/memory/MemoryMainCard'
import OnboardingCTA from '@/components/onboarding/OnboardingCTA'
import T from '@/components/ui/T'
import { ONBOARDING_SECTIONS } from '@/lib/onboarding/sections'
import type { ClientLifecycleStage, MemoryProfile } from '@/lib/types/client'
import type { TranslationKey } from '@/lib/i18n'

const STAGE_COLORS: Record<ClientLifecycleStage, { bg: string; fg: string; border: string }> = {
  prospect: { bg: '#f59e0b15', fg: '#f59e0b', border: '#f59e0b40' },
  active: { bg: '#22c55e15', fg: '#22c55e', border: '#22c55e40' },
  churned: { bg: '#6b728015', fg: '#9ca3af', border: '#6b728040' },
  archived: { bg: '#ffffff08', fg: '#6b7280', border: '#ffffff10' },
}

const STAGE_LABEL_KEYS: Record<ClientLifecycleStage, TranslationKey> = {
  prospect: 'clients.prospect_label',
  active: 'clients.active_label',
  churned: 'clients.churned_label',
  archived: 'clients.archived_label',
}

const BAND_COLORS: Record<string, string> = {
  green: '#22c55e',
  teal: '#14b8a6',
  amber: '#f59e0b',
  red: '#ef4444',
}

const DRIVER_LABELS: Record<string, string> = {
  compliance: 'Compliance',
  experience: 'Experience',
  discoverability: 'Discoverability',
  content: 'Content',
  accessibility: 'Accessibility',
  authority: 'Authority',
  aso_visibility: 'ASO Visibility',
  ai_relevance: 'AI Relevance',
  awareness: 'Awareness',
}

export default async function ClientOverviewPage({
  params,
}: {
  params: { id: string }
}) {
  // user + client are already loaded (and request-cached) by the surrounding
  // client-detail layout, so these resolve without extra round-trips.
  const [user, client] = await Promise.all([getUser(), getClientById(params.id)])
  if (!user) redirect('/login')
  if (!client) redirect('/clients')

  const supabase = await createClient()

  // The remaining reads are independent (they only need the authenticated
  // user + params.id), so fire them concurrently instead of awaiting each in
  // turn. profile.role is request-cached by the dashboard layout, so it
  // resolves instantly here without an extra query.
  const [
    role,
    { data: myMembership },
    { data: subscription },
    { data: recentAnalyses },
    { data: allAnalyses },
    { count: analysesCount },
    { count: martechCount },
    { count: filesCount },
    { data: memoryRow },
  ] = await Promise.all([
    getProfileRole(user.id),
    supabase
      .from('client_members')
      .select('role')
      .eq('client_id', params.id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('client_update_subscriptions')
      .select('is_active')
      .eq('client_id', params.id)
      .maybeSingle(),
    supabase
      .from('analyses')
      .select('id, overall_score, completed_at, domain')
      .eq('client_id', params.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(2),
    supabase
      .from('analyses')
      .select('id, overall_score, completed_at')
      .eq('client_id', params.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: true }),
    supabase
      .from('analyses')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', params.id)
      .eq('status', 'completed'),
    supabase
      .from('client_martech')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', params.id),
    supabase
      .from('client_files')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', params.id),
    supabase
      .from('client_memory')
      .select('profile')
      .eq('client_id', params.id)
      .maybeSingle(),
  ])

  const isAdmin = role === 'admin'

  // canEdit covers most lifecycle actions, canManageOwners is restricted to
  // archive + hard-delete (and member management).
  const myRole = myMembership?.role ?? null
  const canEdit = isAdmin || myRole === 'owner' || myRole === 'editor'
  const canManageOwners = isAdmin || myRole === 'owner'

  const subscriptionActive: boolean | null = subscription?.is_active ?? null

  const lifecycleStage = (client.lifecycle_stage ?? 'prospect') as ClientLifecycleStage
  const stageColors = STAGE_COLORS[lifecycleStage]
  const stageLabelKey = STAGE_LABEL_KEYS[lifecycleStage]

  const latestAnalysis = recentAnalyses?.[0] ?? null
  const previousAnalysis = recentAnalyses?.[1] ?? null

  // Pull every driver_result for this client's completed analyses in ONE query
  // (was N+1: one query per analysis for the trend chart, plus two more for
  // latest/previous). We then group the rows in memory.
  const analysisIds = Array.from(
    new Set([
      ...(allAnalyses ?? []).map((a) => a.id),
      ...(recentAnalyses ?? []).map((a) => a.id),
    ]),
  )

  let allDriverRows: { analysis_id: string; driver_name: string; score: number | null; status: string }[] = []
  if (analysisIds.length > 0) {
    const { data } = await supabase
      .from('driver_results')
      .select('analysis_id, driver_name, score, status')
      .in('analysis_id', analysisIds)
    allDriverRows = data || []
  }

  const driverScores: { driver_name: string; score: number | null; status: string }[] = latestAnalysis
    ? allDriverRows
        .filter((d) => d.analysis_id === latestAnalysis.id)
        .map(({ driver_name, score, status }) => ({ driver_name, score, status }))
    : []

  const prevDriverScores: Record<string, number | null> = {}
  if (previousAnalysis) {
    for (const d of allDriverRows) {
      if (d.analysis_id === previousAnalysis.id) prevDriverScores[d.driver_name] = d.score
    }
  }

  // Build trend data (allAnalyses is ordered ascending by completed_at)
  const driverRowsByAnalysis = new Map<string, typeof allDriverRows>()
  for (const d of allDriverRows) {
    const arr = driverRowsByAnalysis.get(d.analysis_id)
    if (arr) arr.push(d)
    else driverRowsByAnalysis.set(d.analysis_id, [d])
  }

  const trendData: { date: string; overall_score: number | null; [key: string]: string | number | null }[] = []
  for (const a of allAnalyses ?? []) {
    const point: Record<string, string | number | null> = {
      date: a.completed_at || a.id,
      overall_score: a.overall_score,
    }
    for (const d of driverRowsByAnalysis.get(a.id) ?? []) {
      point[d.driver_name] = d.score
    }
    trendData.push(point as typeof trendData[0])
  }
  const onboardingState =
    ((memoryRow?.profile as MemoryProfile | null)?.onboarding) ?? {
      version: 1,
      status: 'not_started' as const,
      completed_sections: [] as string[],
      skipped_fields: [] as string[],
    }

  const overallScore = latestAnalysis?.overall_score ?? null
  const band = overallScore !== null ? getScoreBand(overallScore) : null
  const color = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'

  // Calculate overall delta
  const overallDelta = calcDelta(
    latestAnalysis?.overall_score ?? null,
    previousAnalysis?.overall_score ?? null,
  )

  // Delta colors
  const deltaColor = overallDelta.direction === 'up' ? '#22c55e' : overallDelta.direction === 'down' ? '#ef4444' : '#6b7280'
  const deltaArrow = overallDelta.direction === 'up' ? '\u2191' : overallDelta.direction === 'down' ? '\u2193' : '\u2192'

  return (
    <div>
      {/* Lifecycle stage banner */}
      <div
        className="flex items-center justify-between gap-4 px-[18px] py-[14px] rounded-xl mb-5"
        style={{
          background: stageColors.bg,
          border: `1px solid ${stageColors.border}`,
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="inline-block px-2.5 py-[3px] rounded-full text-[11px] font-bold tracking-wide uppercase font-mono"
            style={{
              background: stageColors.fg + '22',
              color: stageColors.fg,
            }}
          >
            <T k={stageLabelKey} />
          </span>
          {lifecycleStage === 'active' && client.engagement_started_at && (
            <span className="text-xs text-gray-500">
              <T k="clients.engaged_since" />: {new Date(client.engagement_started_at).toLocaleDateString('en-US')}
            </span>
          )}
          {lifecycleStage === 'churned' && client.engagement_ended_at && (
            <span className="text-xs text-gray-500">
              <T k="clients.churned_on" />: {new Date(client.engagement_ended_at).toLocaleDateString('en-US')}
            </span>
          )}
        </div>
        <LifecycleActions
          clientId={params.id}
          stage={lifecycleStage}
          subscriptionActive={subscriptionActive}
          engagementStartedAt={client.engagement_started_at ?? null}
          canEdit={canEdit}
          canManageOwners={canManageOwners}
        />
      </div>

      {/* Phase 5D — onboarding CTA (hidden once completed) */}
      <OnboardingCTA
        clientId={params.id}
        status={onboardingState.status}
        completedSections={onboardingState.completed_sections.length}
        totalSections={ONBOARDING_SECTIONS.length}
      />

      {/* Quick stats grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* Overall Score + Delta */}
        <div className="bg-card rounded-xl border border-border p-5 text-center">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 font-mono">
            <T k="clients.currentScore" />
          </div>
          <div
            className="text-4xl font-bold font-mono"
            style={{ color: overallScore !== null ? color : '#6b7280' }}
          >
            {overallScore ?? '\u2014'}
          </div>
          {band && (
            <div className="text-xs mt-1" style={{ color }}>
              <T k={band.label as TranslationKey} />
            </div>
          )}
          {overallDelta.direction !== 'unknown' && (
            <div
              className="text-xs mt-1 font-mono font-semibold"
              style={{ color: deltaColor }}
            >
              {deltaArrow} {overallDelta.delta !== null && (overallDelta.delta > 0 ? '+' : '')}{overallDelta.delta !== null ? Math.round(overallDelta.delta) : ''} <T k="clients.vsPrevious" />
            </div>
          )}
        </div>

        {/* Analyses count */}
        <div className="bg-card rounded-xl border border-border p-5 text-center">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 font-mono">
            <T k="clients.analyses" />
          </div>
          <div className="text-4xl font-bold text-white font-mono">
            {analysesCount ?? 0}
          </div>
          {latestAnalysis?.completed_at && (
            <div className="text-xs text-gray-500 mt-1">
              <T k="clients.last" />: {new Date(latestAnalysis.completed_at).toLocaleDateString('en-US')}
            </div>
          )}
        </div>

        {/* MarTech Stack */}
        <div className="bg-card rounded-xl border border-border p-5 text-center">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 font-mono">
            <T k="clients.martechStack" />
          </div>
          <div className="text-4xl font-bold text-white font-mono">
            {martechCount ?? 0}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {(martechCount ?? 0) > 0 ? <T k="clients.toolsDetected" /> : <T k="clients.toAnalyze" />}
          </div>
        </div>

        {/* Files */}
        <div className="bg-card rounded-xl border border-border p-5 text-center">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 font-mono">
            <T k="clients.knowledge" />
          </div>
          <div className="text-4xl font-bold text-white font-mono">
            {filesCount ?? 0}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            <T k="clients.documents" />
          </div>
        </div>
      </div>

      {/* Trend Chart */}
      {trendData.length >= 2 && (
        <div className="bg-card rounded-xl border border-border p-5 mb-6">
          <h3 className="font-mono text-[13px] font-semibold text-primary uppercase tracking-wide mb-4">
            <T k="clients.trendScore" />
          </h3>
          <ClientOverviewTrend data={trendData} />
        </div>
      )}

      {/* Driver Scores grid with delta arrows */}
      {driverScores.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5 mb-6">
          <h3 className="font-mono text-[13px] font-semibold text-primary uppercase tracking-wide mb-4">
            <T k="clients.driverScores" />
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {driverScores.map((dr) => {
              const drBand = dr.score !== null ? getScoreBand(dr.score) : null
              const drColor = drBand ? BAND_COLORS[drBand.color] ?? '#6b7280' : '#6b7280'
              const drDelta = calcDelta(dr.score, prevDriverScores[dr.driver_name] ?? null)
              const drDeltaColor = drDelta.direction === 'up' ? '#22c55e' : drDelta.direction === 'down' ? '#ef4444' : '#6b7280'
              const drArrow = drDelta.direction === 'up' ? '\u2191' : drDelta.direction === 'down' ? '\u2193' : drDelta.direction === 'stable' ? '\u2192' : ''

              return (
                <div key={dr.driver_name} className="flex items-center gap-3 px-3.5 py-2.5 bg-background rounded-lg">
                  <div
                    className="w-9 h-9 rounded-md flex items-center justify-center font-mono text-sm font-bold shrink-0"
                    style={{ background: `${drColor}15`, color: drColor }}
                  >
                    {dr.score ?? '\u2014'}
                  </div>
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold text-white">
                      {DRIVER_LABELS[dr.driver_name] || dr.driver_name}
                    </div>
                    <div className="text-[11px] flex items-center gap-1.5" style={{ color: drColor }}>
                      {drBand ? <T k={drBand.label as TranslationKey} /> : dr.status}
                      {drArrow && (
                        <span
                          className="font-mono font-bold"
                          style={{ color: drDeltaColor }}
                        >
                          {drArrow}{drDelta.delta !== null ? (drDelta.delta > 0 ? '+' : '') + Math.round(drDelta.delta) : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Client Memory (Phase 5D) — compact view always visible */}
      <MemoryMainCard clientId={params.id} />

      {/* Monitoring (Phase 4C) — visible for every non-archived stage.
          Prospects see a locked informative card pointing at the Activate
          CTA; active/churned clients see the full scheduling panel. */}
      {lifecycleStage === 'prospect' && <MonitoringLockedCard />}
      {(lifecycleStage === 'active' || lifecycleStage === 'churned') && (
        <MonitoringPanel clientId={params.id} canEdit={canEdit} />
      )}

      {/* Team & Sharing (Phase 4A) */}
      <TeamPanel
        clientId={params.id}
        currentUserId={user.id}
        isAdmin={isAdmin}
      />

      {/* Quick actions */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-mono text-[13px] font-semibold text-[#a0a0a0] uppercase tracking-wide mb-4">
          <T k="clients.quickActions" />
        </h3>
        <div className="flex gap-3 flex-wrap">
          {/* Single onboarding mechanic (V4): new analyses start in the
              New-audit wizard, pre-bound to this client. The V1 analyzer
              stays parked behind the legacy flag. */}
          <Link
            href={`/analyzer/v4?client=${params.id}`}
            className="px-5 py-2.5 bg-primary text-background rounded-lg text-[13px] font-bold no-underline font-mono"
          >
            <T k="clients.newAnalysis" />
          </Link>
          <Link
            href={`/clients/${params.id}/martech`}
            className="px-5 py-2.5 bg-border text-white rounded-lg text-[13px] font-semibold no-underline"
          >
            <T k="clients.detectMartech" />
          </Link>
          <Link
            href={`/clients/${params.id}/chat`}
            className="px-5 py-2.5 bg-border text-white rounded-lg text-[13px] font-semibold no-underline"
          >
            <T k="common.askJ" />
          </Link>
          {client.contact_name && (
            <div className="text-[13px] text-gray-500 flex items-center gap-1.5 ml-auto">
              <T k="clients.contact" />: <span className="text-[#a0a0a0]">{client.contact_name}</span>
              {client.contact_email && (
                <span className="text-gray-500">({client.contact_email})</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
