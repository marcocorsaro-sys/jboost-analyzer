import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  AlertCircle,
  RefreshCw,
  CheckSquare,
  UserPlus,
  Briefcase,
  LineChart,
  Users,
  TrendingUp,
  DollarSign,
  Sparkles,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import T from '@/components/ui/T'

type AlertRow = {
  id: string
  message: string | null
  severity: string | null
  client_id: string | null
}

type ClientRow = {
  id: string
  name: string
  domain: string | null
  lifecycle_stage?: string | null
  status?: string | null
}

type AnalysisRow = {
  id: string
  domain: string
  overall_score: number | null
  status: string
  created_at: string
  client_id: string | null
}

async function safeCount(
  fn: () => PromiseLike<{ count: number | null; error: unknown }>
): Promise<number> {
  try {
    const { count, error } = await fn()
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

async function safeList<T>(
  fn: () => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  try {
    const { data, error } = await fn()
    if (error) return []
    return data ?? []
  } catch {
    return []
  }
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  const isAdmin = profile?.role === 'admin'

  // ── Overview KPIs (ported from legacy /dashboard so we don't lose the
  //    at-a-glance numbers that Horizon 1 Stage 2 had removed) ──
  const activeClientsCount = await safeCount(
    () =>
      supabase
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('lifecycle_stage', 'active')
        .neq('status', 'archived') as unknown as PromiseLike<{ count: number | null; error: unknown }>
  )

  const completedAnalysesCount = await safeCount(
    () =>
      supabase
        .from('analyses')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'completed') as unknown as PromiseLike<{ count: number | null; error: unknown }>
  )

  // Average score across the 6 most recently updated active clients, same
  // sample set the legacy dashboard used. Wrapped in safeList so a missing
  // lifecycle_stage column (pre-phase-4b env) doesn't crash the whole page.
  const topActive = await safeList<{ id: string }>(
    () =>
      supabase
        .from('clients')
        .select('id')
        .eq('lifecycle_stage', 'active')
        .neq('status', 'archived')
        .order('updated_at', { ascending: false })
        .limit(6) as unknown as PromiseLike<{ data: { id: string }[] | null; error: unknown }>
  )
  const topActiveIds = topActive.map((c) => c.id)
  let avgScore: number | null = null
  if (topActiveIds.length > 0) {
    const scores = await Promise.all(
      topActiveIds.map(async (id) => {
        const { data: latest } = await supabase
          .from('analyses')
          .select('overall_score')
          .eq('client_id', id)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        return (latest as { overall_score: number | null } | null)?.overall_score ?? null
      })
    )
    const nonNull = scores.filter((s): s is number => s !== null)
    avgScore =
      nonNull.length > 0
        ? Math.round(nonNull.reduce((a, b) => a + b, 0) / nonNull.length)
        : null
  }

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  // ── Today: alerts (table may not exist in all envs) ──
  const alerts = await safeList<AlertRow>(
    () =>
      supabase
        .from('alerts')
        .select('id, message, severity, client_id')
        .eq('is_read', false)
        .limit(3) as unknown as PromiseLike<{ data: AlertRow[] | null; error: unknown }>
  )

  type WeeklyUpdate = { id: string; client_id: string; clients?: { name: string } | null }
  const weeklyUpdates = await safeList<WeeklyUpdate>(
    () =>
      supabase
        .from('client_update_subscriptions')
        .select('id, client_id, clients(name)')
        .eq('is_active', true)
        .gte('last_run_at', weekAgo)
        .limit(5) as unknown as PromiseLike<{ data: WeeklyUpdate[] | null; error: unknown }>
  )

  type ActionItemRow = { id: string; title: string | null; client_id: string | null }
  const actionItems = await safeList<ActionItemRow>(
    () =>
      supabase
        .from('meeting_notes')
        .select('id, title, client_id, action_items')
        .not('action_items', 'is', null)
        .limit(5) as unknown as PromiseLike<{ data: ActionItemRow[] | null; error: unknown }>
  )

  // ── My Work: clients split by stage (fallback: use status) ──
  let myClientsRaw: ClientRow[] | null = null
  {
    const withLifecycle = await supabase
      .from('clients')
      .select('id, name, domain, status, lifecycle_stage')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
    if (!withLifecycle.error) {
      myClientsRaw = (withLifecycle.data ?? []) as ClientRow[]
    } else {
      const fallback = await supabase
        .from('clients')
        .select('id, name, domain, status')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
      myClientsRaw = (fallback.data ?? []) as ClientRow[]
    }
  }

  const myClients = myClientsRaw ?? []
  const myProspects = myClients.filter(
    (c) => (c.lifecycle_stage ?? c.status) === 'prospect'
  )
  const myActiveClients = myClients.filter(
    (c) => (c.lifecycle_stage ?? c.status) === 'active'
  )

  const activeEnriched: Array<ClientRow & { latest_score: number | null }> = await Promise.all(
    myActiveClients.slice(0, 5).map(async (c) => {
      const { data: latest } = await supabase
        .from('analyses')
        .select('overall_score')
        .eq('client_id', c.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const score = (latest as { overall_score: number | null } | null)?.overall_score ?? null
      return { ...c, latest_score: score }
    })
  )

  // ── My Work: recent analyses ──
  const recentAnalyses = await safeList<AnalysisRow>(
    () =>
      supabase
        .from('analyses')
        .select('id, domain, overall_score, status, created_at, client_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5) as unknown as PromiseLike<{ data: AnalysisRow[] | null; error: unknown }>
  )

  // ── Team Pulse (admin only) ──
  let analysesToday = 0
  let llmSpend = 0
  let topHealth: Array<{ id: string; name: string; score: number | null }> = []

  if (isAdmin) {
    analysesToday = await safeCount(
      () =>
        supabase
          .from('analyses')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStart.toISOString()) as unknown as PromiseLike<{ count: number | null; error: unknown }>
    )

    try {
      const usageRes = await supabase
        .from('llm_usage')
        .select('estimated_cost_usd')
        .gte('created_at', monthStart.toISOString())
      if (!usageRes.error) {
        const rows = (usageRes.data ?? []) as Array<{ estimated_cost_usd: number | null }>
        llmSpend = rows.reduce((acc, row) => acc + Number(row.estimated_cost_usd ?? 0), 0)
      }
    } catch {
      llmSpend = 0
    }

    const allClientsRes = await supabase
      .from('clients')
      .select('id, name')
      .limit(50)
    const allClients = (allClientsRes.data ?? []) as Array<{ id: string; name: string }>
    const withScores = await Promise.all(
      allClients.map(async (c) => {
        const { data: latest } = await supabase
          .from('analyses')
          .select('overall_score')
          .eq('client_id', c.id)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        return { id: c.id, name: c.name, score: latest?.overall_score ?? null }
      })
    )
    topHealth = withScores
      .filter((c) => c.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 5)
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          <T k="home.title" />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <T k="home.subtitle" />
        </p>
      </header>

      {/* ── OVERVIEW KPIs (ported from legacy /dashboard) ── */}
      <section>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>
                <T k="dashboard.activeClients" />
              </CardDescription>
              <CardTitle className="font-mono text-4xl text-primary">
                {activeClientsCount}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>
                <T k="dashboard.completedAnalyses" />
              </CardDescription>
              <CardTitle className="font-mono text-4xl text-foreground">
                {completedAnalysesCount}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>
                <T k="dashboard.averageScore" />
              </CardDescription>
              <CardTitle className="font-mono text-4xl text-primary">
                {avgScore ?? '—'}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* ── TODAY ── */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">
            <T k="home.today_section" />
          </h2>
          <span className="text-sm text-muted-foreground">{today}</span>
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">
                  <T k="home.alerts_card" />
                </CardTitle>
                <CardDescription>{alerts.length} unread</CardDescription>
              </div>
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <T k="home.alerts_empty" />
                </p>
              ) : (
                <ul className="space-y-2">
                  {alerts.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 text-sm">
                      <span
                        className={
                          a.severity === 'critical' || a.severity === 'high'
                            ? 'mt-1 h-2 w-2 shrink-0 rounded-full bg-destructive'
                            : 'mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500'
                        }
                      />
                      <span className="line-clamp-2 text-foreground">
                        {a.message ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">
                  <T k="home.weekly_updates_card" />
                </CardTitle>
                <CardDescription>{weeklyUpdates.length} ready</CardDescription>
              </div>
              <RefreshCw className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {weeklyUpdates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <T k="home.no_data" />
                </p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {weeklyUpdates.slice(0, 5).map((u) => (
                    <li key={u.id} className="truncate text-foreground">
                      {u.clients?.name ?? u.client_id}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">
                  <T k="home.action_items_card" />
                </CardTitle>
                <CardDescription>{actionItems.length} pending</CardDescription>
              </div>
              <CheckSquare className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {actionItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <T k="home.no_data" />
                </p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {actionItems.slice(0, 5).map((a) => (
                    <li key={a.id} className="truncate text-foreground">
                      {a.title ?? '—'}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* ── MY WORK ── */}
      <section>
        <h2 className="mb-4 text-2xl font-semibold tracking-tight">
          <T k="home.my_work_section" />
        </h2>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">
                  <T k="home.my_prospects" />
                </CardTitle>
                <CardDescription>{myProspects.length} total</CardDescription>
              </div>
              <UserPlus className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {myProspects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <T k="home.no_data" />
                </p>
              ) : (
                <ul className="space-y-2">
                  {myProspects.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/clients/${c.id}`}
                        className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-accent"
                      >
                        <span className="truncate">{c.name}</span>
                        <Badge variant="outline" className="ml-2 shrink-0">
                          prospect
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">
                  <T k="home.my_active_clients" />
                </CardTitle>
                <CardDescription>{myActiveClients.length} total</CardDescription>
              </div>
              <Briefcase className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {activeEnriched.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <T k="home.no_data" />
                </p>
              ) : (
                <ul className="space-y-2">
                  {activeEnriched.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/clients/${c.id}`}
                        className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-accent"
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="ml-2 shrink-0 font-mono text-xs text-primary">
                          {c.latest_score ?? '—'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">
                  <T k="home.recent_analyses" />
                </CardTitle>
                <CardDescription>{recentAnalyses.length} recent</CardDescription>
              </div>
              <LineChart className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {recentAnalyses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <T k="home.no_data" />
                </p>
              ) : (
                <ul className="space-y-2">
                  {recentAnalyses.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/results/${a.id}`}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
                      >
                        <span className="min-w-0 truncate">{a.domain}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant={a.status === 'completed' ? 'default' : 'secondary'}
                          >
                            {a.status}
                          </Badge>
                          <span className="font-mono text-xs text-primary">
                            {a.overall_score ?? '—'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {isAdmin && (
        <>
          <Separator />
          <section>
            <h2 className="mb-4 text-2xl font-semibold tracking-tight">
              <T k="home.team_pulse_section" />
            </h2>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base">
                      <T k="home.analyses_today" />
                    </CardTitle>
                  </div>
                  <Users className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="font-mono text-3xl font-bold text-primary">{analysesToday}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base">
                      <T k="home.llm_spend_month" />
                    </CardTitle>
                  </div>
                  <DollarSign className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="font-mono text-3xl font-bold text-primary">
                    ${llmSpend.toFixed(2)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base">
                      <T k="home.top_health" />
                    </CardTitle>
                  </div>
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {topHealth.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      <T k="home.no_data" />
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {topHealth.map((c) => (
                        <li
                          key={c.id}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="truncate">{c.name}</span>
                          <span className="ml-2 shrink-0 font-mono text-xs text-primary">
                            {c.score}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
        </>
      )}

      <Separator className="my-2" />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 text-primary" />
        Ask J can dig deeper — try the command palette.
      </div>
    </div>
  )
}
