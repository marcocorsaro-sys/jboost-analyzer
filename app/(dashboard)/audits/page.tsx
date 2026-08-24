import type { CSSProperties } from 'react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient, getProfileRole, getUser } from '@/lib/supabase/server'
import { listV4Audits, AUDIT_STATE_META } from '@/lib/v4/audits'
import { formatLocalDate, isValidLocale, type Locale } from '@/lib/i18n'
import T from '@/components/ui/T'
import SwitchToClientButton from '@/components/audits/SwitchToClientButton'
import ControllerBadge from '@/components/audits/ControllerBadge'
import { B } from '@/lib/brand'

export const dynamic = 'force-dynamic'

/**
 * Audits (UX-UI Bibbia 04 + mockup UX approvato): righe ariose — dominio con
 * sottoriga competitor, chip stato (Completo / N in attesa / In corso /
 * Errore), Index 28px navy right-aligned, data, azioni ghost "Apri" e
 * promozione "Switch to client" (o "Report" quando l'audit è completo).
 *
 * Server component: the list is one batched read (lib/v4/audits). The only
 * client islands are the <T> translation leaves and the Switch-to-client
 * button — the REAL promotion (POST /api/v4/analyses/[id]/promote).
 */
export default async function AuditsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const cookieStore = await cookies()
  const rawLocale = cookieStore.get('jboost-locale')?.value
  const locale: Locale = isValidLocale(rawLocale) ? rawLocale : 'en'

  const supabase = await createClient()
  const audits = await listV4Audits(supabase)
  const runningCount = audits.filter((a) => a.state === 'running').length

  // Controller column, admins only: the sweep crosses ownership boundaries,
  // so the server decides here whether to render the client island at all.
  const isAdmin = (await getProfileRole(user.id)) === 'admin'

  const thStyle: CSSProperties = {
    ...B.type.label,
    color: B.muted,
    textAlign: 'left',
    padding: '0 16px 12px',
    borderBottom: `1px solid ${B.border}`,
    whiteSpace: 'nowrap',
  }
  const tdStyle: CSSProperties = {
    padding: '16px',
    fontSize: '15px',
    borderBottom: `1px solid ${B.surface}`,
    verticalAlign: 'middle',
  }
  const chipStyle = (color: string): CSSProperties => ({
    display: 'inline-block',
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: 1.3,
    color,
    background: `${color}14`,
    border: `1px solid ${color}26`,
    borderRadius: '999px',
    padding: '5px 12px',
    whiteSpace: 'nowrap',
  })
  const ghostAction: CSSProperties = {
    display: 'inline-block',
    background: B.bg,
    border: `1px solid ${B.border}`,
    borderRadius: B.radius.control,
    color: B.ink,
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: 1.3,
    textDecoration: 'none',
    transition: B.transition,
  }

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: '30px',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: B.ink,
            }}
          >
            <T k="nav.audits" />
          </h1>
          <div style={{ marginTop: '6px', fontSize: '15px', color: B.muted }}>
            {audits.length} <T k="audits.sub_analyses" />
            {runningCount > 0 && (
              <>
                {' '}· {runningCount} <T k="audits.sub_running" />
              </>
            )}
          </div>
        </div>
        <Link
          href="/analyzer/v4"
          className="rounded-xl px-5 py-3 text-[15px] font-bold text-white no-underline transition-opacity hover:opacity-90"
          style={{ background: B.primary }}
        >
          <T k="home.start_new_audit" />
        </Link>
      </div>

      {audits.length === 0 ? (
        /* Empty state → CTA straight into the setup wizard. */
        <div className="rounded-2xl border border-border bg-card py-16 text-center">
          <div className="mb-4 text-sm text-muted-foreground">
            <T k="audits.empty" />
          </div>
          <Link
            href="/analyzer/v4"
            className="inline-block rounded-lg px-5 py-2.5 text-[14px] font-bold text-white no-underline transition-opacity hover:opacity-90"
            style={{ background: B.primary }}
          >
            <T k="home.start_new_audit" />
          </Link>
        </div>
      ) : (
        /* Panel bianco radius 16, tabella full-bleed (mockup .panel). */
        <div
          style={{
            background: B.bg,
            border: `1px solid ${B.border}`,
            borderRadius: B.radius.card,
            boxShadow: B.shadow.card,
            padding: '20px 0 8px',
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, paddingLeft: '32px' }}>
                  <T k="audits.col_audit" />
                </th>
                <th style={thStyle}>
                  <T k="audits.col_state" />
                </th>
                <th style={{ ...thStyle, textAlign: 'right' }}>
                  <T k="audits.col_index" />
                </th>
                <th style={thStyle}>
                  <T k="audits.col_date" />
                </th>
                {isAdmin && (
                  <th style={{ ...thStyle, textAlign: 'center' }}>
                    <T k="audits.col_controller" />
                  </th>
                )}
                <th style={{ ...thStyle, textAlign: 'right', paddingRight: '32px' }}>
                  <T k="audits.col_actions" />
                </th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a, i) => {
                const last = i === audits.length - 1
                const complete = a.driversTotal > 0 && a.driversDone === a.driversTotal
                const rowBorder = last ? { borderBottom: 0 } : {}
                return (
                  <tr key={a.id}>
                    <td style={{ ...tdStyle, ...rowBorder, paddingLeft: '32px' }}>
                      <div style={{ fontSize: '17px', fontWeight: 650, color: B.ink }}>
                        {a.name}
                        {/* Discreet client marker for drafts (their action is
                            "Resume setup"); started audits get the linkable
                            "Cliente" chip in the actions cell instead. */}
                        {a.clientId && !a.started && (
                          <span style={{ ...chipStyle(B.primary), marginLeft: '8px', verticalAlign: 'middle' }}>
                            <T k="audits.client_badge" />
                          </span>
                        )}
                      </div>
                      {a.competitors.length > 0 ? (
                        <div style={{ fontSize: '13px', color: B.muted, marginTop: '2px' }}>
                          <T k="audits.vs" /> {a.competitors.join(', ')}
                        </div>
                      ) : (
                        a.domain &&
                        a.domain !== a.name && (
                          <div style={{ fontSize: '13px', color: B.muted, marginTop: '2px' }}>{a.domain}</div>
                        )
                      )}
                    </td>
                    <td style={{ ...tdStyle, ...rowBorder }}>
                      {/* Chip stato (mockup): In corso / N in attesa / Errore /
                          Completo; altrimenti lo stato pill esistente. */}
                      {a.state === 'running' ? (
                        <span style={chipStyle(B.teal)}>
                          <T k="v4res.state_running" />
                        </span>
                      ) : a.state === 'needs_decision' ? (
                        <span style={chipStyle(B.warning)}>
                          {a.driversNeedsDecision} <T k="audits.waiting_suffix" />
                        </span>
                      ) : a.driversError > 0 ? (
                        <span style={chipStyle(B.error)}>
                          {a.driversError} <T k="audits.errors_suffix" />
                        </span>
                      ) : complete ? (
                        <span style={chipStyle(B.success)}>
                          <T k="audits.state_complete" />
                        </span>
                      ) : (
                        <span style={chipStyle(AUDIT_STATE_META[a.state].color)}>
                          <T k={AUDIT_STATE_META[a.state].labelKey} />
                        </span>
                      )}
                      {a.driversTotal > 0 && (
                        <span style={{ marginLeft: '8px', fontSize: '13px', color: B.muted }}>
                          {a.driversDone}/{a.driversTotal}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        ...rowBorder,
                        textAlign: 'right',
                        fontSize: '28px',
                        fontWeight: 750,
                        fontVariantNumeric: 'tabular-nums',
                        color: B.primary,
                      }}
                    >
                      {a.overallScore ?? '—'}
                    </td>
                    <td style={{ ...tdStyle, ...rowBorder, color: B.muted, whiteSpace: 'nowrap' }}>
                      {formatLocalDate(a.createdAt, locale)}
                    </td>
                    {isAdmin && (
                      <td style={{ ...tdStyle, ...rowBorder, textAlign: 'center' }}>
                        <ControllerBadge analysisId={a.id} />
                      </td>
                    )}
                    <td
                      style={{
                        ...tdStyle,
                        ...rowBorder,
                        textAlign: 'right',
                        paddingRight: '32px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {/* A draft never launched has no results to open: the
                          action is resuming the setup wizard on it. */}
                      {a.started ? (
                        <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                          <Link href={`/results/v4/${a.id}`} style={ghostAction} className="hover:bg-accent">
                            <T k="audits.open" />
                          </Link>
                          <SwitchToClientButton analysisId={a.id} auditName={a.name} clientId={a.clientId} />
                          {complete && (
                            <Link
                              href={`/results/v4/${a.id}?tab=output`}
                              className="inline-block rounded-xl px-4 py-2 text-[14px] font-bold text-white no-underline transition-opacity hover:opacity-90"
                              style={{ background: B.primary }}
                            >
                              <T k="audits.report" />
                            </Link>
                          )}
                        </span>
                      ) : (
                        <Link
                          href={`/analyzer/v4?resume=${a.id}`}
                          className="inline-block rounded-xl px-4 py-2 text-[14px] font-bold text-white no-underline transition-opacity hover:opacity-90"
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
