import { createClient, getUser, getClientById } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getScoreBand } from '@/lib/constants'
import { calcDelta } from '@/lib/trends/calculate'
import ClientAnalysesList from '@/components/clients/ClientAnalysesList'
import UnlinkedAnalyses from '@/components/clients/UnlinkedAnalyses'
import T from '@/components/ui/T'
import type { TranslationKey } from '@/lib/i18n'
import { B } from '@/lib/brand'

const BAND_COLORS: Record<string, string> = {
  green: B.success,
  teal: B.teal,
  amber: B.warning,
  red: B.error,
}

/**
 * Client panel — V4 minimal (Bibbia 04: "panel UI = future", "the Client
 * section has not been developed at this stage"). This page keeps ONLY what
 * the Struttura sheet asks for on the client side: the latest score with the
 * delta vs the previous run, the list of the client's analyses, and the
 * "Nuova analisi" action into the V4 wizard (?client= pre-binding, already
 * supported by lib/v4/setup).
 *
 * Everything else of the V1 panel (lifecycle banner, onboarding CTA, martech
 * and knowledge counters, trend chart, driver grid, memory, monitoring, team)
 * is PARKED for the future ongoing version: see page.parked.tsx next to this
 * file and the untouched components under components/clients, components/
 * memory, components/onboarding.
 */
export default async function ClientOverviewPage({
  params,
}: {
  params: { id: string }
}) {
  const [user, client] = await Promise.all([getUser(), getClientById(params.id)])
  if (!user) redirect('/login')
  if (!client) redirect('/clients')

  const supabase = await createClient()

  const { data: analyses } = await supabase
    .from('analyses')
    .select(
      'id, domain, country, language, status, overall_score, created_at, completed_at, competitors, target_topic, ref_date',
    )
    .eq('client_id', params.id)
    .order('created_at', { ascending: false })

  const allAnalyses = analyses ?? []

  // Sprint 1 item 4c: analyses on the SAME domain never linked to this
  // client (client_id null). Counted in the stat card as "da associare" and
  // listed with the one-click Associa action.
  const { data: unlinkedRows } = client.domain
    ? await supabase
        .from('analyses')
        .select('id, domain, status, created_at, ref_date')
        .is('client_id', null)
        .eq('domain', client.domain)
        .order('created_at', { ascending: false })
    : { data: [] as never[] }
  const unlinked = unlinkedRows ?? []
  const completed = allAnalyses
    .filter((a) => a.status === 'completed')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  const latest = completed[0] ?? null
  const previous = completed[1] ?? null

  const overallScore = latest?.overall_score ?? null
  const band = overallScore !== null ? getScoreBand(overallScore) : null
  const color = band ? BAND_COLORS[band.color] ?? B.muted : B.muted

  const overallDelta = calcDelta(
    latest?.overall_score ?? null,
    previous?.overall_score ?? null,
  )
  const deltaColor =
    overallDelta.direction === 'up'
      ? B.success
      : overallDelta.direction === 'down'
        ? B.error
        : B.muted
  const deltaArrow =
    overallDelta.direction === 'up'
      ? '↑'
      : overallDelta.direction === 'down'
        ? '↓'
        : '→'

  return (
    <div>
      {/* Score header: latest score + delta vs previous run (needs >= 2) */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:max-w-md">
        <div
          className="border border-border bg-card p-6 text-center"
          style={{ borderRadius: B.radius.card, boxShadow: B.shadow.card }}
        >
          <div className="mb-2 font-mono text-[13px] uppercase tracking-wide text-muted-foreground">
            <T k="clients.currentScore" />
          </div>
          <div
            className="font-mono text-4xl font-bold"
            style={{ color: overallScore !== null ? color : B.muted }}
          >
            {overallScore ?? '—'}
          </div>
          {band && (
            <div className="mt-1 text-sm" style={{ color }}>
              <T k={band.label as TranslationKey} />
            </div>
          )}
          {overallDelta.direction !== 'unknown' && (
            <div
              className="mt-1 font-mono text-sm font-semibold"
              style={{ color: deltaColor }}
            >
              {deltaArrow}{' '}
              {overallDelta.delta !== null && (overallDelta.delta > 0 ? '+' : '')}
              {overallDelta.delta !== null ? Math.round(overallDelta.delta) : ''}{' '}
              <T k="clients.vsPrevious" />
            </div>
          )}
        </div>

        <div
          className="border border-border bg-card p-6 text-center"
          style={{ borderRadius: B.radius.card, boxShadow: B.shadow.card }}
        >
          <div className="mb-2 font-mono text-[13px] uppercase tracking-wide text-muted-foreground">
            <T k="clients.analyses" />
          </div>
          <div className="font-mono text-4xl font-bold text-foreground">
            {completed.length}
            {unlinked.length > 0 && (
              <span className="ml-2 align-middle text-sm font-semibold" style={{ color: B.warning }}>
                +{unlinked.length} da associare
              </span>
            )}
          </div>
          {latest?.completed_at && (
            <div className="mt-1 text-sm text-muted-foreground">
              <T k="clients.last" />:{' '}
              {new Date(latest.completed_at).toLocaleDateString('en-US')}
            </div>
          )}
        </div>
      </div>

      {/* Analisi con lo stesso dominio non ancora associate (Sprint 1 4c). */}
      <UnlinkedAnalyses
        clientId={params.id}
        analyses={unlinked as React.ComponentProps<typeof UnlinkedAnalyses>['analyses']}
      />

      {/* Analyses list + "Nuova Analisi" action (the CTA inside the list
          header links to /analyzer/v4?client=<id>) */}
      <ClientAnalysesList
        analyses={allAnalyses as React.ComponentProps<typeof ClientAnalysesList>['analyses']}
        clientId={params.id}
        clientDomain={client.domain ?? null}
      />
    </div>
  )
}
