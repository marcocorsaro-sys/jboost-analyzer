import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient, getProfileRole, getUser } from '@/lib/supabase/server'
import { listV4Audits, AUDIT_STATE_META } from '@/lib/v4/audits'
import { getScoreBand } from '@/lib/constants'
import { formatLocalDate, isValidLocale, type Locale } from '@/lib/i18n'
import T from '@/components/ui/T'
import SwitchToClientButton from '@/components/audits/SwitchToClientButton'
import ControllerBadge from '@/components/audits/ControllerBadge'
import { B } from '@/lib/brand'

export const dynamic = 'force-dynamic'

const BAND_COLORS: Record<string, string> = {
  green: B.success,
  teal: B.teal,
  amber: B.warning,
  red: B.error,
}

/**
 * Audits (UX-UI Bibbia 04, "Navigation & Screens"): the list of one-off V4
 * audits with score and date; open the analysis or promote it with
 * 'Switch to client'. V1 called this section "Prospects" — renamed per
 * Comparazione 07 ("Rinominata 'Audits' in V4").
 *
 * Server component: the list is one batched read (lib/v4/audits). The only
 * client islands are the <T> translation leaves and the Switch-to-client
 * button — the REAL promotion (POST /api/v4/analyses/[id]/promote): the one
 * onboarding mechanic where a prospect audit becomes a client. Promoted
 * audits show a discreet "Cliente" chip instead of the button.
 */
export default async function AuditsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const cookieStore = await cookies()
  const rawLocale = cookieStore.get('jboost-locale')?.value
  const locale: Locale = isValidLocale(rawLocale) ? rawLocale : 'en'

  const supabase = await createClient()
  const audits = await listV4Audits(supabase)

  // Controller column, admins only: the sweep crosses ownership boundaries,
  // so the server decides here whether to render the client island at all —
  // the badge then fetches ?scope=all lazily, never blocking this render.
  const isAdmin = (await getProfileRole(user.id)) === 'admin'

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          <T k="nav.audits" />
        </h1>
        <Link
          href="/analyzer/v4"
          className="rounded-lg px-4 py-2 text-[13px] font-bold text-white no-underline transition-opacity hover:opacity-90"
          style={{ background: B.primary }}
        >
          <T k="home.start_new_audit" />
        </Link>
      </div>

      {audits.length === 0 ? (
        /* Empty state → CTA straight into the setup wizard. */
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <div className="mb-4 text-sm text-muted-foreground">
            <T k="audits.empty" />
          </div>
          <Link
            href="/analyzer/v4"
            className="inline-block rounded-lg px-5 py-2.5 text-[13px] font-bold text-white no-underline transition-opacity hover:opacity-90"
            style={{ background: B.primary }}
          >
            <T k="home.start_new_audit" />
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <T k="audits.col_audit" />
                </th>
                <th className="px-4 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <T k="audits.col_date" />
                </th>
                <th className="px-4 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <T k="audits.col_state" />
                </th>
                <th className="px-4 py-3 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <T k="audits.col_score" />
                </th>
                {isAdmin && (
                  <th className="px-4 py-3 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <T k="audits.col_controller" />
                  </th>
                )}
                <th className="px-4 py-3 text-right font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <T k="audits.col_actions" />
                </th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => {
                const band = getScoreBand(a.overallScore)
                const scoreColor = band ? BAND_COLORS[band.color] ?? B.muted : B.muted
                const stateMeta = AUDIT_STATE_META[a.state]
                return (
                  <tr key={a.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">
                        {a.name}
                        {/* Discreet client marker for drafts (their action is
                            "Resume setup"); started audits get the linkable
                            "Cliente" chip in the actions cell instead. */}
                        {a.clientId && !a.started && (
                          <span
                            className="ml-2 inline-block rounded-full px-2 py-0.5 align-middle text-[10px] font-semibold"
                            style={{ background: B.primarySoft, color: B.primary }}
                          >
                            <T k="audits.client_badge" />
                          </span>
                        )}
                      </div>
                      {a.domain && a.domain !== a.name && (
                        <div className="text-[11px] text-muted-foreground">{a.domain}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatLocalDate(a.createdAt, locale)}
                    </td>
                    <td className="px-4 py-3">
                      {/* State pill — same priority + palette as ResultsView. */}
                      <span
                        className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                        style={{ background: `${stateMeta.color}18`, color: stateMeta.color }}
                      >
                        <T k={stateMeta.labelKey} />
                      </span>
                      {a.driversTotal > 0 && (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          {a.driversDone}/{a.driversTotal}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-mono text-sm font-bold" style={{ color: scoreColor }}>
                        {a.overallScore ?? '—'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-center">
                        <ControllerBadge analysisId={a.id} />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {/* A draft never launched has no results to open: the
                          action is resuming the setup wizard on it. */}
                      {a.started ? (
                        <>
                          <Link
                            href={`/results/v4/${a.id}`}
                            className="mr-2 inline-block rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground no-underline transition-colors hover:bg-accent"
                          >
                            <T k="audits.open" />
                          </Link>
                          <SwitchToClientButton
                            analysisId={a.id}
                            auditName={a.name}
                            clientId={a.clientId}
                          />
                        </>
                      ) : (
                        <Link
                          href={`/analyzer/v4?resume=${a.id}`}
                          className="inline-block rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white no-underline transition-opacity hover:opacity-90"
                          style={{ background: B.primary }}
                        >
                          <T k="audits.resume_setup" />
                        </Link>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
