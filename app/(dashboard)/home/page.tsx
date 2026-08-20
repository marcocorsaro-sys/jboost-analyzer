import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient, getUser } from '@/lib/supabase/server'
import { listV4Audits, AUDIT_STATE_META } from '@/lib/v4/audits'
import { getScoreBand } from '@/lib/constants'
import { formatLocalDate, isValidLocale, type Locale } from '@/lib/i18n'
import T from '@/components/ui/T'

export const dynamic = 'force-dynamic'

const BAND_COLORS: Record<string, string> = {
  green: '#22c55e',
  teal: '#14b8a6',
  amber: '#f59e0b',
  red: '#ef4444',
}

/**
 * Home (UX-UI Bibbia 04, "Navigation & Screens"):
 * headliner 'J-Boost Analyzer' · primary blue 'Start new audit' button ·
 * Audits widget (first 3 + link to All audits) · Clients widget (first 3 +
 * link to All clients). Clean, uncluttered — deliberately NO aggregate
 * metrics (Comparazione 07: "elemento non prioritario in V4").
 *
 * Server component: all data arrives in the first HTML response. The only
 * client islands are the <T> translation leaves of the existing pattern.
 */
export default async function HomePage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const cookieStore = await cookies()
  const rawLocale = cookieStore.get('jboost-locale')?.value
  const locale: Locale = isValidLocale(rawLocale) ? rawLocale : 'en'

  const supabase = await createClient()

  // Widgets are independent — fetch them concurrently. RLS scopes both.
  const [audits, { data: clients }] = await Promise.all([
    listV4Audits(supabase, { limit: 3 }),
    supabase
      .from('clients')
      .select('id, name, domain, industry')
      .eq('lifecycle_stage', 'active')
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
      .limit(3),
  ])

  const topClients = clients ?? []

  return (
    <div className="mx-auto max-w-4xl">
      {/* Headliner + primary CTA */}
      <div className="mb-10 mt-4 text-center">
        <h1 className="font-mono text-3xl font-bold text-foreground">
          J-Boost Analyzer
        </h1>
        <Link
          href="/analyzer/v4"
          className="mt-6 inline-block rounded-lg px-6 py-3 text-sm font-bold text-white no-underline transition-opacity hover:opacity-90"
          style={{ background: '#2563eb' }}
        >
          <T k="home.start_new_audit" />
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Audits widget — first 3, link to All audits */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-[13px] font-semibold uppercase tracking-wide text-primary">
              <T k="nav.audits" />
            </h2>
            <Link href="/audits" className="text-xs text-muted-foreground no-underline hover:text-foreground">
              <T k="home.all_audits" />
            </Link>
          </div>

          {audits.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <T k="home.no_audits" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {audits.map((a) => {
                const band = getScoreBand(a.overallScore)
                const color = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'
                const stateMeta = AUDIT_STATE_META[a.state]
                return (
                  /* An unlaunched draft opens back into the setup wizard. */
                  <Link
                    key={a.id}
                    href={a.started ? `/results/v4/${a.id}` : `/analyzer/v4?resume=${a.id}`}
                    className="no-underline"
                  >
                    <div className="flex items-center gap-3 rounded-lg bg-background px-3.5 py-2.5 transition-colors hover:bg-accent">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md font-mono text-sm font-bold"
                        style={{ background: `${color}15`, color }}
                      >
                        {a.overallScore ?? '—'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-foreground">
                          {a.name}
                          {/* Promoted audit → discreet client marker. */}
                          {a.clientId && (
                            <span
                              className="ml-2 inline-block rounded-full px-2 py-0.5 align-middle text-[10px] font-semibold"
                              style={{ background: '#c8e64a18', color: '#c8e64a' }}
                            >
                              <T k="audits.client_badge" />
                            </span>
                          )}
                        </div>
                        <div className="text-[11px]" style={{ color: stateMeta.color }}>
                          <T k={stateMeta.labelKey} />
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] text-muted-foreground">
                        {formatLocalDate(a.createdAt, locale, { day: '2-digit', month: 'short' })}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Clients widget — first 3 active, link to All clients */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-[13px] font-semibold uppercase tracking-wide text-primary">
              <T k="nav.clients" />
            </h2>
            <Link href="/clients" className="text-xs text-muted-foreground no-underline hover:text-foreground">
              <T k="home.all_clients" />
            </Link>
          </div>

          {topClients.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <T k="home.no_clients" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {topClients.map((c) => (
                <Link key={c.id} href={`/clients/${c.id}`} className="no-underline">
                  <div className="flex items-center gap-3 rounded-lg bg-background px-3.5 py-2.5 transition-colors hover:bg-accent">
                    <div className="min-w-0 flex-1">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-foreground">
                        {c.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.domain || c.industry || '—'}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
