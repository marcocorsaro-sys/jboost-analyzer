import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getScoreBand } from '@/lib/constants'
import { calcDelta } from '@/lib/trends/calculate'
import Link from 'next/link'
import ClientOverviewTrend from '@/components/clients/ClientOverviewTrend'
import PromoteButton from '@/components/clients/PromoteButton'
import T from '@/components/ui/T'
import type { ClientLifecycleStage } from '@/lib/types/client'
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!client) redirect('/clients')

  // Fetch current user profile to determine admin privileges (needed for
  // the "Promote to Active" CTA on prospect clients).
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const isAdmin = profile?.role === 'admin'
  const lifecycleStage = (client.lifecycle_stage ?? 'prospect') as ClientLifecycleStage
  const stageColors = STAGE_COLORS[lifecycleStage]
  const stageLabelKey = STAGE_LABEL_KEYS[lifecycleStage]

  // Fetch last 2 completed analyses for delta calculation
  const { data: recentAnalyses } = await supabase
    .from('analyses')
    .select('id, overall_score, completed_at, domain')
    .eq('client_id', params.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(2)

  const latestAnalysis = recentAnalyses?.[0] ?? null
  const previousAnalysis = recentAnalyses?.[1] ?? null

  // Fetch driver scores for latest + previous
  let driverScores: { driver_name: string; score: number | null; status: string }[] = []
  let prevDriverScores: Record<string, number | null> = {}

  if (latestAnalysis) {
    const { data } = await supabase
      .from('driver_results')
      .select('driver_name, score, status')
      .eq('analysis_id', latestAnalysis.id)
    driverScores = data || []
  }

  if (previousAnalysis) {
    const { data } = await supabase
      .from('driver_results')
      .select('driver_name, score')
      .eq('analysis_id', previousAnalysis.id)
    for (const d of (data || [])) {
      prevDriverScores[d.driver_name] = d.score
    }
  }

  // Fetch ALL completed analyses for trend chart
  const { data: allAnalyses } = await supabase
    .from('analyses')
    .select('id, overall_score, completed_at')
    .eq('client_id', params.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: true })

  // Build trend data
  const trendData: { date: string; overall_score: number | null; [key: string]: string | number | null }[] = []
  if (allAnalyses && allAnalyses.length > 0) {
    for (const a of allAnalyses) {
      const { data: drivers } = await supabase
        .from('driver_results')
        .select('driver_name, score')
        .eq('analysis_id', a.id)

      const point: Record<string, string | number | null> = {
        date: a.completed_at || a.id,
        overall_score: a.overall_score,
      }
      for (const d of (drivers || [])) {
        point[d.driver_name] = d.score
      }
      trendData.push(point as typeof trendData[0])
    }
  }

  // Counts
  const { count: analysesCount } = await supabase
    .from('analyses')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', params.id)
    .eq('status', 'completed')

  const { count: martechCount } = await supabase
    .from('client_martech')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', params.id)

  const { count: filesCount } = await supabase
    .from('client_files')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', params.id)

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
  const deltaArrow = overallDelta.direction === 'up' ? '↑' : overallDelta.direction === 'down' ? '↓' : '→'

  return (
    <div>
      {/* Lifecycle stage banner */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '14px 18px',
        background: stageColors.bg,
        border: `1px solid ${stageColors.border}`,
        borderRadius: '12px',
        marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: '999px',
              background: stageColors.fg + '22',
              color: stageColors.fg,
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <T k={stageLabelKey} />
          </span>
          {lifecycleStage === 'active' && client.engagement_started_at && (
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              <T k="clients.engaged_since" />: {new Date(client.engagement_started_at).toLocaleDateString('en-US')}
            </span>
          )}
          {lifecycleStage === 'churned' && client.engagement_ended_at && (
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              <T k="clients.churned_on" />: {new Date(client.engagement_ended_at).toLocaleDateString('en-US')}
            </span>
          )}
        </div>
        {isAdmin && lifecycleStage === 'prospect' && (
          <PromoteButton clientId={params.id} />
        )}
      </div>

      {/* Quick stats grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
        marginBottom: '24px',
      }}>
        {/* Overall Score + Delta */}
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
            <T k="clients.currentScore" />
          </div>
          <div style={{
            fontSize: '36px',
            fontWeight: 700,
            color: overallScore !== null ? color : '#6b7280',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {overallScore ?? '—'}
          </div>
          {band && (
            <div style={{ fontSize: '12px', color, marginTop: '4px' }}>
              {band.label}
            </div>
          )}
          {overallDelta.direction !== 'unknown' && (
            <div style={{
              fontSize: '12px',
              color: deltaColor,
              marginTop: '4px',
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 600,
            }}>
              {deltaArrow} {overallDelta.delta !== null && (overallDelta.delta > 0 ? '+' : '')}{overallDelta.delta !== null ? Math.round(overallDelta.delta) : ''} <T k="clients.vsPrevious" />
            </div>
          )}
        </div>

        {/* Analyses count */}
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
            <T k="clients.analyses" />
          </div>
          <div style={{ fontSize: '36px', fontWeight: 700, color: '#ffffff', fontFamily: "'JetBrains Mono', monospace" }}>
            {analysesCount ?? 0}
          </div>
          {latestAnalysis?.completed_at && (
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
              <T k="clients.last" />: {new Date(latestAnalysis.completed_at).toLocaleDateString('en-US')}
            </div>
          )}
        </div>

        {/* MarTech Stack */}
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
            <T k="clients.martechStack" />
          </div>
          <div style={{ fontSize: '36px', fontWeight: 700, color: '#ffffff', fontFamily: "'JetBrains Mono', monospace" }}>
            {martechCount ?? 0}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
            {(martechCount ?? 0) > 0 ? <T k="clients.toolsDetected" /> : <T k="clients.toAnalyze" />}
          </div>
        </div>

        {/* Files */}
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
            <T k="clients.knowledge" />
          </div>
          <div style={{ fontSize: '36px', fontWeight: 700, color: '#ffffff', fontFamily: "'JetBrains Mono', monospace" }}>
            {filesCount ?? 0}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
            <T k="clients.documents" />
          </div>
        </div>
      </div>

      {/* Trend Chart */}
      {trendData.length >= 2 && (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '20px',
          marginBottom: '24px',
        }}>
          <h3 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '13px',
            fontWeight: 600,
            color: '#c8e64a',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '16px',
          }}>
            <T k="clients.trendScore" />
          </h3>
          <ClientOverviewTrend data={trendData} />
        </div>
      )}

      {/* Driver Scores grid with delta arrows */}
      {driverScores.length > 0 && (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '20px',
          marginBottom: '24px',
        }}>
          <h3 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '13px',
            fontWeight: 600,
            color: '#c8e64a',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '16px',
          }}>
            <T k="clients.driverScores" />
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {driverScores.map((dr) => {
              const drBand = dr.score !== null ? getScoreBand(dr.score) : null
              const drColor = drBand ? BAND_COLORS[drBand.color] ?? '#6b7280' : '#6b7280'
              const drDelta = calcDelta(dr.score, prevDriverScores[dr.driver_name] ?? null)
              const drDeltaColor = drDelta.direction === 'up' ? '#22c55e' : drDelta.direction === 'down' ? '#ef4444' : '#6b7280'
              const drArrow = drDelta.direction === 'up' ? '↑' : drDelta.direction === 'down' ? '↓' : drDelta.direction === 'stable' ? '→' : ''

              return (
                <div key={dr.driver_name} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  background: '#111318',
                  borderRadius: '8px',
                }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '14px',
                    fontWeight: 700,
                    background: `${drColor}15`,
                    color: drColor,
                    flexShrink: 0,
                  }}>
                    {dr.score ?? '—'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#ffffff' }}>
                      {DRIVER_LABELS[dr.driver_name] || dr.driver_name}
                    </div>
                    <div style={{ fontSize: '11px', color: drColor, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {drBand?.label ?? dr.status}
                      {drArrow && (
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 700,
                          color: drDeltaColor,
                        }}>
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

      {/* Quick actions */}
      <div style={{
        background: '#1a1c24',
        borderRadius: '12px',
        border: '1px solid #2a2d35',
        padding: '20px',
      }}>
        <h3 style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '13px',
          fontWeight: 600,
          color: '#a0a0a0',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '16px',
        }}>
          <T k="clients.quickActions" />
        </h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Link
            href={`/analyzer?client=${params.id}&domain=${client.domain || ''}`}
            style={{
              padding: '10px 20px',
              background: '#c8e64a',
              color: '#111318',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              textDecoration: 'none',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <T k="clients.newAnalysis" />
          </Link>
          <Link
            href={`/clients/${params.id}/martech`}
            style={{
              padding: '10px 20px',
              background: '#2a2d35',
              color: '#ffffff',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <T k="clients.detectMartech" />
          </Link>
          <Link
            href={`/clients/${params.id}/chat`}
            style={{
              padding: '10px 20px',
              background: '#2a2d35',
              color: '#ffffff',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <T k="common.askJ" />
          </Link>
          {client.contact_name && (
            <div style={{ fontSize: '13px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
              <T k="clients.contact" />: <span style={{ color: '#a0a0a0' }}>{client.contact_name}</span>
              {client.contact_email && (
                <span style={{ color: '#6b7280' }}>({client.contact_email})</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
