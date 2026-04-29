/**
 * SnapshotReport — componente di rendering del payload `DomainSnapshot`
 * prodotto da `lib/integrations/use-cases/pre-sales/domain-snapshot.ts`.
 *
 * Stile coerente col dark dashboard di JBA: card lime/dark, KPI grandi a
 * vista, sezioni per provider con score + dettaglio essenziale + missing
 * high-value items. Tutto Server Component-friendly (zero hooks, zero JS).
 */

import type { DomainSnapshot } from '@/lib/integrations/use-cases/pre-sales/domain-snapshot'

interface Props {
  snapshot: DomainSnapshot
}

export function SnapshotReport({ snapshot }: Props) {
  return (
    <div className="space-y-8">
      <HeroScore snapshot={snapshot} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <IndexabilityCard snap={snapshot} />
        <StructuredDataCard snap={snapshot} />
        <CruxCard snap={snapshot} />
        <AiVisibilityCard snap={snapshot} />
        <MarTechCard snap={snapshot} />
        <WhoisCard snap={snapshot} />
      </div>
      {snapshot.errors.length > 0 && (
        <ErrorsCard errors={snapshot.errors} />
      )}
    </div>
  )
}

// =========================================================================
// Hero — score sintetico + meta dell'analisi
// =========================================================================

function HeroScore({ snapshot }: Props) {
  const score = snapshot.presalesScore
  const tone = scoreTone(score)
  return (
    <div className="rounded-lg border bg-card text-card-foreground p-6">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
            Pre-sales snapshot
          </div>
          <h1 className="text-3xl font-bold leading-tight">{snapshot.domain}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {fmtDate(snapshot.startedAt)} · {(snapshot.elapsedMs / 1000).toFixed(1)}s · {snapshot.errors.length} provider error
            {snapshot.errors.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="text-right">
          <div className={`text-6xl font-black leading-none ${tone}`}>
            {score !== null ? score : '—'}
          </div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mt-2">
            score / 100
          </div>
        </div>
      </div>
    </div>
  )
}

// =========================================================================
// Provider cards
// =========================================================================

function IndexabilityCard({ snap }: { snap: DomainSnapshot }) {
  const idx = snap.indexability
  if (!idx) return <CardShell title="Indexability" body="Not available" />
  const issues = idx.issues
  return (
    <CardShell title="Indexability" score={idx.score}>
      <div className="space-y-2 text-sm">
        <Row label="robots.txt" value={idx.robots.found ? (idx.robots.blocksAllCrawl ? 'BLOCKS ALL' : 'OK') : 'missing'} bad={!idx.robots.found || idx.robots.blocksAllCrawl} />
        <Row
          label="Sitemap"
          value={idx.sitemap ? `${idx.sitemap.urlCount} URLs (${idx.sitemap.kind})` : 'not declared'}
          bad={!idx.sitemap}
        />
        <Row
          label="Homepage robots"
          value={idx.homepage?.isNoindex ? 'NOINDEX' : idx.homepage?.metaRobots ?? 'default (index)'}
          bad={idx.homepage?.isNoindex === true}
        />
        <Row
          label="Canonical"
          value={idx.homepage?.canonical ? '✓ declared' : 'missing'}
          bad={!idx.homepage?.canonical}
        />
        <Row
          label="Hreflang"
          value={
            idx.homepage && idx.homepage.hreflangCount > 0
              ? `${idx.homepage.hreflangCount} (${idx.homepage.hreflangLangs.slice(0, 3).join(', ')}${idx.homepage.hreflangLangs.length > 3 ? '...' : ''})`
              : 'none'
          }
        />
        {issues.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border space-y-1">
            {issues.map((iss, i) => (
              <div key={i} className="text-xs flex items-start gap-2">
                <span className={severityBadge(iss.severity)}>{iss.severity}</span>
                <span className="text-muted-foreground">{iss.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </CardShell>
  )
}

function StructuredDataCard({ snap }: { snap: DomainSnapshot }) {
  const sd = snap.structuredData
  if (!sd) return <CardShell title="Structured Data" body="Not available" />
  return (
    <CardShell title="Structured Data" score={sd.coverage.score}>
      <div className="space-y-2 text-sm">
        <Row label="Pages with schema" value={`${sd.pagesWithSchema}/${sd.pages.length}`} />
        <Row label="Total JSON-LD blocks" value={String(sd.totalBlocks)} />
        {sd.totalParseErrors > 0 && (
          <Row label="Parse errors" value={String(sd.totalParseErrors)} bad />
        )}
        <Row
          label="Types found"
          value={sd.uniqueTypes.length === 0 ? '(none)' : sd.uniqueTypes.slice(0, 6).join(', ') + (sd.uniqueTypes.length > 6 ? '...' : '')}
          bad={sd.uniqueTypes.length === 0}
        />
        {sd.coverage.missingHighValueTypes.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
              Missing high-value types
            </div>
            <div className="flex flex-wrap gap-1">
              {sd.coverage.missingHighValueTypes.map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </CardShell>
  )
}

function CruxCard({ snap }: { snap: DomainSnapshot }) {
  const c = snap.crux
  if (!c) return <CardShell title="Real-User Performance (CrUX)" body="Not available" />
  if (!c.available) {
    return (
      <CardShell title="Real-User Performance (CrUX)">
        <p className="text-sm text-muted-foreground">
          Insufficient Chrome traffic for this origin — Google CrUX needs ~1k visits/month
          to publish data. <span className="italic">Indicator of low brand awareness on web.</span>
        </p>
      </CardShell>
    )
  }
  return (
    <CardShell title="Real-User Performance (CrUX)" score={c.score}>
      <div className="grid grid-cols-3 gap-3 text-center">
        <Metric label="LCP" value={c.lcpMs ? `${(c.lcpMs / 1000).toFixed(2)}s` : '—'} good={c.lcpMs !== null && c.lcpMs <= 2500} poor={c.lcpMs !== null && c.lcpMs > 4000} />
        <Metric label="INP" value={c.inpMs ? `${c.inpMs}ms` : '—'} good={c.inpMs !== null && c.inpMs <= 200} poor={c.inpMs !== null && c.inpMs > 500} />
        <Metric label="CLS" value={c.clsValue !== null ? c.clsValue.toFixed(3) : '—'} good={c.clsValue !== null && c.clsValue <= 0.1} poor={c.clsValue !== null && c.clsValue > 0.25} />
      </div>
      {c.collectionPeriod && (
        <p className="mt-3 text-xs text-muted-foreground">
          Period: {c.collectionPeriod.from} → {c.collectionPeriod.to} (form factor: {c.formFactor.toLowerCase()})
        </p>
      )}
    </CardShell>
  )
}

function AiVisibilityCard({ snap }: { snap: DomainSnapshot }) {
  const ai = snap.ai
  if (!ai) {
    return (
      <CardShell title="AI Visibility (DataForSEO)">
        <p className="text-sm text-muted-foreground">
          Skipped — no keywords passed. To enable, pass `keywords` to the snapshot
          builder (typical: top 50–100 organic from SEMrush).
        </p>
      </CardShell>
    )
  }
  return (
    <CardShell title="AI Visibility (DataForSEO)" score={Math.round(ai.aiOverviewPercentage)}>
      <div className="space-y-2 text-sm">
        <Row label="Keywords scanned" value={`${ai.successCount}/${ai.totalKeywords}`} />
        <Row label="With AI Overview" value={`${ai.aiOverviewCount} (${ai.aiOverviewPercentage}%)`} />
        <Row label="With Featured Snippet" value={String(ai.featuredSnippetCount)} />
        <Row label="With People Also Ask" value={String(ai.peopleAlsoAskCount)} />
        <Row label="Client in top 10" value={`${ai.clientTop10Count} keyword(s)`} />
        <Row label="Cost (USD)" value={`$${ai.totalCostUsd.toFixed(4)}`} />
      </div>
    </CardShell>
  )
}

function MarTechCard({ snap }: { snap: DomainSnapshot }) {
  const t = snap.tech
  if (!t || !t.ok) return <CardShell title="MarTech Stack" body={t?.error ?? 'Not available'} />
  const cats = Object.entries(t.byCategory).sort(([, a], [, b]) => b - a)
  return (
    <CardShell title="MarTech Stack" body={`${t.technologies.length} tech in ${cats.length} categories`}>
      <div className="space-y-3 mt-2">
        {cats.map(([cat, count]) => (
          <div key={cat}>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
              {cat} ({count})
            </div>
            <div className="flex flex-wrap gap-1">
              {t.technologies
                .filter((tt) => tt.category === cat)
                .map((tt) => (
                  <span
                    key={tt.name}
                    className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground"
                    title={`confidence ${tt.confidence}%, via ${tt.matchedVia.join('+')}`}
                  >
                    {tt.name}
                    {tt.version ? ` v${tt.version}` : ''}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </CardShell>
  )
}

function WhoisCard({ snap }: { snap: DomainSnapshot }) {
  const w = snap.whois
  if (!w || !w.ok) return <CardShell title="Domain Identity (WHOIS)" body={w?.error ?? 'Not available'} />
  return (
    <CardShell title="Domain Identity (WHOIS)">
      <div className="space-y-2 text-sm">
        <Row label="Domain age" value={w.ageYears !== null ? `${w.ageYears} years` : '—'} />
        <Row label="Registered" value={w.registrationDate ? fmtDate(w.registrationDate) : '—'} />
        <Row label="Expires" value={w.expirationDate ? fmtDate(w.expirationDate) : '—'} bad={w.daysToExpiry !== null && w.daysToExpiry < 60} />
        <Row label="Days to renewal" value={w.daysToExpiry !== null ? `${w.daysToExpiry}d` : '—'} bad={w.daysToExpiry !== null && w.daysToExpiry < 60} />
        <Row label="Registrar" value={w.registrar ?? '—'} />
        {w.nameservers.length > 0 && (
          <Row label="Nameservers" value={w.nameservers.slice(0, 2).join(', ') + (w.nameservers.length > 2 ? '...' : '')} />
        )}
      </div>
    </CardShell>
  )
}

function ErrorsCard({ errors }: { errors: DomainSnapshot['errors'] }) {
  return (
    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
      <div className="text-xs uppercase tracking-widest text-yellow-500 mb-2">
        Provider errors ({errors.length})
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        {errors.map((e, i) => (
          <div key={i}>
            <span className="font-mono">{e.provider}:</span> {e.message}
          </div>
        ))}
      </div>
    </div>
  )
}

// =========================================================================
// Building blocks
// =========================================================================

function CardShell({
  title,
  score,
  body,
  children,
}: {
  title: string
  score?: number | null
  body?: string
  children?: React.ReactNode
}) {
  const tone = score !== undefined && score !== null ? scoreTone(score) : ''
  return (
    <div className="rounded-lg border bg-card text-card-foreground p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
        {score !== undefined && score !== null && (
          <div className={`text-2xl font-black leading-none ${tone}`}>{score}</div>
        )}
      </div>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
      {children}
    </div>
  )
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={bad ? 'text-red-400' : ''}>{value}</span>
    </div>
  )
}

function Metric({ label, value, good, poor }: { label: string; value: string; good?: boolean; poor?: boolean }) {
  const cls = good ? 'text-green-400' : poor ? 'text-red-400' : 'text-yellow-400'
  return (
    <div className="rounded border border-border p-2">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${cls}`}>{value}</div>
    </div>
  )
}

// =========================================================================
// Helpers
// =========================================================================

function scoreTone(score: number | null): string {
  if (score === null) return 'text-muted-foreground'
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-lime-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-red-400'
}

function severityBadge(sev: 'critical' | 'warning' | 'info'): string {
  const base = 'text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold '
  if (sev === 'critical') return base + 'bg-red-500/20 text-red-400'
  if (sev === 'warning') return base + 'bg-yellow-500/20 text-yellow-400'
  return base + 'bg-muted text-muted-foreground'
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toISOString().slice(0, 10)
  } catch {
    return iso
  }
}
