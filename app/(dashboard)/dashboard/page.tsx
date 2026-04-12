import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getScoreBand } from '@/lib/constants'
import Link from 'next/link'
import T from '@/components/ui/T'

const BAND_COLORS: Record<string, string> = {
  green: '#22c55e',
  teal: '#14b8a6',
  amber: '#f59e0b',
  red: '#ef4444',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch active clients with latest scores.
  // NOTE: filter by lifecycle_stage='active' so prospects (which still have
  // the legacy status='active') do not pollute the dashboard counters.
  // Access is enforced by RLS via client_members (no user_id filter needed).
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, domain, industry')
    .eq('lifecycle_stage', 'active')
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(6)

  // Enrich clients with latest score
  const topClients = await Promise.all(
    (clients || []).map(async (c) => {
      const { data: latest } = await supabase
        .from('analyses')
        .select('overall_score, completed_at')
        .eq('client_id', c.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .single()

      return {
        ...c,
        latest_score: latest?.overall_score ?? null,
        latest_analysis_at: latest?.completed_at ?? null,
      }
    })
  )

  // Counts — only truly active (lifecycle) clients, not prospects.
  // Access is enforced by RLS via client_members.
  const { count: totalClients } = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('lifecycle_stage', 'active')
    .neq('status', 'archived')

  const { count: totalAnalyses } = await supabase
    .from('analyses')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'completed')

  // Average score across latest analyses
  const avgScore = topClients.length > 0
    ? Math.round(
        topClients
          .filter(c => c.latest_score !== null)
          .reduce((sum, c) => sum + (c.latest_score ?? 0), 0)
        / Math.max(topClients.filter(c => c.latest_score !== null).length, 1)
      )
    : null

  return (
    <div>
      <h2 style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '20px',
        fontWeight: 700,
        color: '#ffffff',
        marginBottom: '24px',
      }}>
        <T k="nav.dashboard" />
      </h2>

      {/* KPI Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '16px',
        marginBottom: '32px',
      }}>
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
            <T k="dashboard.activeClients" />
          </div>
          <div style={{ fontSize: '36px', fontWeight: 700, color: '#c8e64a', fontFamily: "'JetBrains Mono', monospace" }}>
            {totalClients ?? 0}
          </div>
        </div>

        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
            <T k="dashboard.completedAnalyses" />
          </div>
          <div style={{ fontSize: '36px', fontWeight: 700, color: '#ffffff', fontFamily: "'JetBrains Mono', monospace" }}>
            {totalAnalyses ?? 0}
          </div>
        </div>

        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
            <T k="dashboard.averageScore" />
          </div>
          <div style={{
            fontSize: '36px',
            fontWeight: 700,
            color: avgScore !== null ? (avgScore >= 80 ? '#22c55e' : avgScore >= 60 ? '#14b8a6' : avgScore >= 40 ? '#f59e0b' : '#ef4444') : '#6b7280',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {avgScore ?? '—'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        {/* Top Clients */}
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '13px',
              fontWeight: 600,
              color: '#c8e64a',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              <T k="dashboard.recentClients" />
            </h3>
            <Link href="/clients" style={{ fontSize: '12px', color: '#6b7280', textDecoration: 'none' }}>
              <T k="dashboard.viewAll" />
            </Link>
          </div>

          {topClients.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
                <T k="dashboard.noClientsYet" />
              </div>
              <Link
                href="/clients/new"
                style={{
                  padding: '8px 16px',
                  background: '#c8e64a',
                  color: '#111318',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  textDecoration: 'none',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                <T k="dashboard.addClient" />
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topClients.map((c) => {
                const band = c.latest_score !== null ? getScoreBand(c.latest_score) : null
                const color = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'
                return (
                  <Link key={c.id} href={`/clients/${c.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 14px',
                      background: '#111318',
                      borderRadius: '8px',
                      transition: 'background 0.2s',
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
                        background: `${color}15`,
                        color: color,
                        flexShrink: 0,
                      }}>
                        {c.latest_score ?? '—'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#6b7280' }}>
                          {c.domain || <T k="dashboard.noDomain" />}
                        </div>
                      </div>
                      {c.latest_analysis_at && (
                        <div style={{ fontSize: '11px', color: '#6b7280', flexShrink: 0 }}>
                          {new Date(c.latest_analysis_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Quick Actions */}
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
            color: '#c8e64a',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '16px',
          }}>
            <T k="dashboard.quickActions" />
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Link
              href="/clients/new"
              style={{
                padding: '10px 16px',
                background: '#c8e64a',
                color: '#111318',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                textDecoration: 'none',
                fontFamily: "'JetBrains Mono', monospace",
                textAlign: 'center',
              }}
            >
              <T k="dashboard.newClient" />
            </Link>
            <Link
              href="/analyzer"
              style={{
                padding: '10px 16px',
                background: '#2a2d35',
                color: '#ffffff',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                textDecoration: 'none',
                textAlign: 'center',
              }}
            >
              <T k="dashboard.analyzeDomain" />
            </Link>
            <Link
              href="/ask-j"
              style={{
                padding: '10px 16px',
                background: '#2a2d35',
                color: '#ffffff',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                textDecoration: 'none',
                textAlign: 'center',
              }}
            >
              <T k="common.askJ" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
