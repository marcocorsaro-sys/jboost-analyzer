import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient, getUser } from '@/lib/supabase/server'
import { listV4Audits, AUDIT_STATE_META } from '@/lib/v4/audits'
import { getScoreBand } from '@/lib/constants'
import { formatLocalDate, isValidLocale, type Locale } from '@/lib/i18n'
import T from '@/components/ui/T'
import { B } from '@/lib/brand'
import BrandHero from '@/components/layout/BrandHero'

export const dynamic = 'force-dynamic'

const BAND_COLORS: Record<string, string> = {
  green: B.success,
  teal: B.teal,
  amber: B.warning,
  red: B.error,
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
    <div className="mx-auto max-w-5xl">
      {/* Headliner — JAKALA BrandHero band + primary CTA */}
      <BrandHero
        className="mb-12 mt-4"
        height={300}
        title="J·Boost Analyzer"
        subtitle="SEO/GEO Analysis Platform"
      >
        <Link
          href="/analyzer/v4"
          className="inline-block rounded-xl px-7 py-3.5 text-[15px] font-bold no-underline transition-opacity hover:opacity-90"
          style={{ background: B.bg, color: B.primary }}
        >
          <T k="home.start_new_audit" />
        </Link>
      </BrandHero>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Audits widget — first 3, link to All audits */}
        <div className="rounded-2xl border border-border bg-card p-7 shadow-[0_1px_2px_rgba(4,0,102,0.05)]">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-primary">
              <T k="nav.audits" />
            </h2>
            <Link href="/audits" className="text-[14px] font-semibold text-muted-foreground no-underline hover:text-foreground">
              <T k="home.all_audits" />
            </Link>
          </div>

          {audits.length === 0 ? (
            <div className="py-10 text-center text-[15px] text-muted-foreground">
              <T k="home.no_audits" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {audits.map((a) => {
                const band = getScoreBand(a.overallScore)
                const color = band ? BAND_COLORS[band.color] ?? B.muted : B.muted
                const stateMeta = AUDIT_STATE_META[a.state]
                return (
                  /* An unlaunched draft opens back into the setup wizard. */
                  <Link
                    key={a.id}
                    href={a.started ? `/results/v4/${a.id}` : `/analyzer/v4?resume=${a.id}`}
                    className="no-underline"
                  >
                    <div className="flex items-center gap-4 rounded-xl bg-background px-4 py-3.5 transition-colors hover:bg-accent">
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold tabular-nums"
                        style={{ background: `${color}15`, color }}
                      >
                        {a.overallScore ?? '—'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold text-foreground">
                          {a.name}
                          {/* Promoted audit → discreet client marker. */}
                          {a.clientId && (
                            <span
                              className="ml-2 inline-block rounded-full px-2.5 py-0.5 align-middle text-[13px] font-semibold"
                              style={{ background: B.primarySoft, color: B.primary }}
                            >
                              <T k="audits.client_badge" />
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[13px] font-medium" style={{ color: stateMeta.color }}>
                          <T k={stateMeta.labelKey} />
                        </div>
                      </div>
                      <div className="shrink-0 text-[13px] text-muted-foreground">
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
        <div className="rounded-2xl border border-border bg-card p-7 shadow-[0_1px_2px_rgba(4,0,102,0.05)]">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-primary">
              <T k="nav.clients" />
            </h2>
            <Link href="/clients" className="text-[14px] font-semibold text-muted-foreground no-underline hover:text-foreground">
              <T k="home.all_clients" />
            </Link>
          </div>

          {topClients.length === 0 ? (
            <div className="py-10 text-center text-[15px] text-muted-foreground">
              <T k="home.no_clients" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {topClients.map((c) => (
                <Link key={c.id} href={`/clients/${c.id}`} className="no-underline">
                  <div className="flex items-center gap-4 rounded-xl bg-background px-4 py-3.5 transition-colors hover:bg-accent">
                    <div className="min-w-0 flex-1">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold text-foreground">
                        {c.name}
                      </div>
                      <div className="mt-0.5 text-[13px] text-muted-foreground">
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
