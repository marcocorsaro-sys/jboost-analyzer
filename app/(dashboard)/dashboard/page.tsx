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

  const avgScoreColor = avgScore !== null
    ? (avgScore >= 80 ? '#22c55e' : avgScore >= 60 ? '#14b8a6' : avgScore >= 40 ? '#f59e0b' : '#ef4444')
    : undefined

  return (
    <div>
      <h2 className="font-mono text-xl font-bold text-foreground mb-6">
        <T k="nav.dashboard" />
      </h2>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-card rounded-xl border border-border p-5 text-center">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 font-mono">
            <T k="dashboard.activeClients" />
          </div>
          <div className="text-4xl font-bold text-primary font-mono">
            {totalClients ?? 0}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5 text-center">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 font-mono">
            <T k="dashboard.completedAnalyses" />
          </div>
          <div className="text-4xl font-bold text-white font-mono">
            {totalAnalyses ?? 0}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5 text-center">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 font-mono">
            <T k="dashboard.averageScore" />
          </div>
          <div
            className="text-4xl font-bold font-mono"
            style={avgScoreColor ? { color: avgScoreColor } : undefined}
          >
            <span className={avgScoreColor ? undefined : 'text-gray-500'}>
              {avgScore ?? '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-6">
        {/* Top Clients */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-mono text-[13px] font-semibold text-primary uppercase tracking-wide">
              <T k="dashboard.recentClients" />
            </h3>
            <Link href="/clients" className="text-xs text-gray-500 no-underline">
              <T k="dashboard.viewAll" />
            </Link>
          </div>

          {topClients.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-sm text-gray-500 mb-3">
                <T k="dashboard.noClientsYet" />
              </div>
              <Link
                href="/clients/new"
                className="inline-block px-4 py-2 bg-primary text-background rounded-lg text-[13px] font-bold no-underline font-mono"
              >
                <T k="dashboard.addClient" />
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {topClients.map((c) => {
                const band = c.latest_score !== null ? getScoreBand(c.latest_score) : null
                const color = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'
                return (
                  <Link key={c.id} href={`/clients/${c.id}`} className="no-underline">
                    <div className="flex items-center gap-3 px-3.5 py-2.5 bg-background rounded-lg transition-colors">
                      <div
                        className="w-9 h-9 rounded-md flex items-center justify-center font-mono text-sm font-bold shrink-0"
                        style={{ background: `${color}15`, color }}
                      >
                        {c.latest_score ?? '—'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis">
                          {c.name}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {c.domain || <T k="dashboard.noDomain" />}
                        </div>
                      </div>
                      {c.latest_analysis_at && (
                        <div className="text-[11px] text-gray-500 shrink-0">
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
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-mono text-[13px] font-semibold text-primary uppercase tracking-wide mb-4">
            <T k="dashboard.quickActions" />
          </h3>
          <div className="flex flex-col gap-2">
            <Link
              href="/clients/new"
              className="block px-4 py-2.5 bg-primary text-background rounded-lg text-[13px] font-bold no-underline font-mono text-center"
            >
              <T k="dashboard.newClient" />
            </Link>
            <Link
              href="/analyzer"
              className="block px-4 py-2.5 bg-border text-white rounded-lg text-[13px] font-semibold no-underline text-center"
            >
              <T k="dashboard.analyzeDomain" />
            </Link>
            <Link
              href="/ask-j"
              className="block px-4 py-2.5 bg-border text-white rounded-lg text-[13px] font-semibold no-underline text-center"
            >
              <T k="common.askJ" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
