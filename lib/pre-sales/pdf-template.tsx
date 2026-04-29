/**
 * PDF Template — render del DomainSnapshot in un report A4 multi-pagina
 * usando @react-pdf/renderer.
 *
 * Convenzioni stile (Jakala-friendly):
 *   - Palette: nero #0a0a0c sfondi card, lime #c8e64a accenti, grigio #7a7f8d testo secondario
 *   - Font: system-default (Helvetica) per max compatibility con react-pdf
 *   - Layout: A4 portrait, padding 40pt, header+footer su ogni pagina
 *   - Sezioni: Hero (1ª pagina) + 6 card provider + footer brand
 *
 * Niente browser headless: tutto pure-JS, gira nel route handler Node di Next.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'
import type { DomainSnapshot } from '@/lib/integrations/use-cases/pre-sales/domain-snapshot'

// =========================================================================
// Stili
// =========================================================================

const COLORS = {
  bg: '#0a0a0c',
  card: '#15161a',
  border: '#2a2c34',
  textPrimary: '#f5f6f8',
  textSecondary: '#a0a3ad',
  textMuted: '#7a7f8d',
  lime: '#c8e64a',
  green: '#7ad07a',
  yellow: '#f5c451',
  red: '#e96a6a',
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: COLORS.bg,
    color: COLORS.textPrimary,
    padding: 32,
    fontFamily: 'Helvetica',
    fontSize: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    paddingBottom: 12,
    borderBottom: `1pt solid ${COLORS.border}`,
  },
  headerBrand: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.lime,
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontSize: 9,
    color: COLORS.textMuted,
  },
  hero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: COLORS.card,
    border: `1pt solid ${COLORS.border}`,
    borderRadius: 6,
    padding: 20,
    marginBottom: 16,
  },
  heroLabel: {
    fontSize: 8,
    color: COLORS.textMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  heroDomain: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  heroMeta: {
    fontSize: 9,
    color: COLORS.textMuted,
  },
  heroScoreNumber: {
    fontSize: 56,
    fontWeight: 'bold',
    lineHeight: 1,
    color: COLORS.lime,
  },
  heroScoreLabel: {
    fontSize: 8,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 4,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: COLORS.card,
    border: `1pt solid ${COLORS.border}`,
    borderRadius: 6,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: COLORS.textSecondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  cardScore: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.lime,
  },
  cardBody: {
    fontSize: 10,
    color: COLORS.textPrimary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rowLabel: {
    color: COLORS.textMuted,
  },
  rowValue: {
    color: COLORS.textPrimary,
  },
  rowValueBad: {
    color: COLORS.red,
  },
  pillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  pill: {
    fontSize: 8,
    color: COLORS.textMuted,
    backgroundColor: COLORS.bg,
    border: `0.5pt solid ${COLORS.border}`,
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 5,
    marginRight: 4,
    marginBottom: 4,
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  metricBox: {
    flex: 1,
    backgroundColor: COLORS.bg,
    border: `0.5pt solid ${COLORS.border}`,
    borderRadius: 4,
    padding: 8,
    marginRight: 6,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 7,
    color: COLORS.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
  },
  issueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  severityBadge: {
    fontSize: 7,
    fontWeight: 'bold',
    color: COLORS.bg,
    backgroundColor: COLORS.yellow,
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 2,
    marginRight: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  severityCritical: { backgroundColor: COLORS.red, color: '#fff' },
  severityWarning: { backgroundColor: COLORS.yellow, color: COLORS.bg },
  severityInfo: { backgroundColor: COLORS.border, color: COLORS.textPrimary },
  issueMessage: {
    fontSize: 9,
    color: COLORS.textMuted,
    flex: 1,
  },
  divider: {
    borderTop: `0.5pt solid ${COLORS.border}`,
    marginVertical: 6,
  },
  sectionLabel: {
    fontSize: 7,
    color: COLORS.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 32,
    right: 32,
    fontSize: 7,
    color: COLORS.textMuted,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTop: `0.5pt solid ${COLORS.border}`,
  },
})

// =========================================================================
// Componenti
// =========================================================================

export function DomainSnapshotPdf({ snapshot }: { snapshot: DomainSnapshot }) {
  return (
    <Document
      title={`JBoost — Pre-Sales Snapshot — ${snapshot.domain}`}
      author="Jakala — JBoost Analyzer"
      creator="JBoost Analyzer"
      producer="@react-pdf/renderer"
    >
      <Page size="A4" style={styles.page} wrap>
        <Header />

        {/* Hero score */}
        <View style={styles.hero}>
          <View>
            <Text style={styles.heroLabel}>Pre-sales snapshot</Text>
            <Text style={styles.heroDomain}>{snapshot.domain}</Text>
            <Text style={styles.heroMeta}>
              {fmtDate(snapshot.startedAt)} · {(snapshot.elapsedMs / 1000).toFixed(1)}s · {snapshot.errors.length} provider error
              {snapshot.errors.length === 1 ? '' : 's'}
            </Text>
          </View>
          <View>
            <Text
              style={[
                styles.heroScoreNumber,
                { color: scoreColor(snapshot.presalesScore) },
              ]}
            >
              {snapshot.presalesScore !== null ? snapshot.presalesScore : '—'}
            </Text>
            <Text style={styles.heroScoreLabel}>Score / 100</Text>
          </View>
        </View>

        {/* 6 cards */}
        <IndexabilityCard snap={snapshot} />
        <StructuredDataCard snap={snapshot} />
        <CruxCard snap={snapshot} />
        <AiVisibilityCard snap={snapshot} />
        <MarTechCard snap={snapshot} />
        <WhoisCard snap={snapshot} />

        {snapshot.errors.length > 0 && <ErrorsCard errors={snapshot.errors} />}

        <Footer snapshot={snapshot} />
      </Page>
    </Document>
  )
}

function Header() {
  return (
    <View style={styles.header} fixed>
      <Text style={styles.headerBrand}>JBOOST · ANALYZER</Text>
      <Text style={styles.headerSubtitle}>Pre-Sales Health Check</Text>
    </View>
  )
}

function Footer({ snapshot }: { snapshot: DomainSnapshot }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{snapshot.domain} · generated {fmtDate(snapshot.completedAt)}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

function IndexabilityCard({ snap }: { snap: DomainSnapshot }) {
  const idx = snap.indexability
  if (!idx) return <SimpleCard title="Indexability" body="Not available" />
  return (
    <View style={styles.card} wrap={false}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Indexability</Text>
        <Text style={[styles.cardScore, { color: scoreColor(idx.score) }]}>{idx.score}</Text>
      </View>
      <Row label="robots.txt" value={idx.robots.found ? (idx.robots.blocksAllCrawl ? 'BLOCKS ALL' : 'OK') : 'missing'} bad={!idx.robots.found || idx.robots.blocksAllCrawl} />
      <Row label="Sitemap" value={idx.sitemap ? `${idx.sitemap.urlCount} URLs (${idx.sitemap.kind})` : 'not declared'} bad={!idx.sitemap} />
      <Row label="Homepage robots" value={idx.homepage?.isNoindex ? 'NOINDEX' : idx.homepage?.metaRobots ?? 'default (index)'} bad={idx.homepage?.isNoindex === true} />
      <Row label="Canonical" value={idx.homepage?.canonical ? '✓ declared' : 'missing'} bad={!idx.homepage?.canonical} />
      <Row
        label="Hreflang"
        value={
          idx.homepage && idx.homepage.hreflangCount > 0
            ? `${idx.homepage.hreflangCount} (${idx.homepage.hreflangLangs.slice(0, 3).join(', ')}${idx.homepage.hreflangLangs.length > 3 ? '...' : ''})`
            : 'none'
        }
      />
      {idx.issues.length > 0 && (
        <>
          <View style={styles.divider} />
          {idx.issues.map((iss, i) => (
            <View key={i} style={styles.issueRow}>
              <Text
                style={[
                  styles.severityBadge,
                  iss.severity === 'critical'
                    ? styles.severityCritical
                    : iss.severity === 'warning'
                      ? styles.severityWarning
                      : styles.severityInfo,
                ]}
              >
                {iss.severity}
              </Text>
              <Text style={styles.issueMessage}>{iss.message}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  )
}

function StructuredDataCard({ snap }: { snap: DomainSnapshot }) {
  const sd = snap.structuredData
  if (!sd) return <SimpleCard title="Structured Data" body="Not available" />
  return (
    <View style={styles.card} wrap={false}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Structured Data</Text>
        <Text style={[styles.cardScore, { color: scoreColor(sd.coverage.score) }]}>{sd.coverage.score}</Text>
      </View>
      <Row label="Pages with schema" value={`${sd.pagesWithSchema}/${sd.pages.length}`} />
      <Row label="Total JSON-LD blocks" value={String(sd.totalBlocks)} />
      {sd.totalParseErrors > 0 && <Row label="Parse errors" value={String(sd.totalParseErrors)} bad />}
      <Row
        label="Types found"
        value={sd.uniqueTypes.length === 0 ? '(none)' : sd.uniqueTypes.slice(0, 6).join(', ') + (sd.uniqueTypes.length > 6 ? '...' : '')}
        bad={sd.uniqueTypes.length === 0}
      />
      {sd.coverage.missingHighValueTypes.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Missing high-value types</Text>
          <View style={styles.pillContainer}>
            {sd.coverage.missingHighValueTypes.map((t) => (
              <Text key={t} style={styles.pill}>
                {t}
              </Text>
            ))}
          </View>
        </>
      )}
    </View>
  )
}

function CruxCard({ snap }: { snap: DomainSnapshot }) {
  const c = snap.crux
  if (!c) return <SimpleCard title="Real-User Performance (CrUX)" body="Not available" />
  if (!c.available) {
    return (
      <SimpleCard
        title="Real-User Performance (CrUX)"
        body="Insufficient Chrome traffic for this origin — Google CrUX needs ~1k visits/month to publish data. Indicator of low brand awareness on web."
      />
    )
  }
  return (
    <View style={styles.card} wrap={false}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Real-User Performance (CrUX)</Text>
        <Text style={[styles.cardScore, { color: scoreColor(c.score) }]}>{c.score ?? '—'}</Text>
      </View>
      <View style={styles.metricsGrid}>
        <Metric label="LCP" value={c.lcpMs ? `${(c.lcpMs / 1000).toFixed(2)}s` : '—'} good={c.lcpMs !== null && c.lcpMs <= 2500} poor={c.lcpMs !== null && c.lcpMs > 4000} />
        <Metric label="INP" value={c.inpMs ? `${c.inpMs}ms` : '—'} good={c.inpMs !== null && c.inpMs <= 200} poor={c.inpMs !== null && c.inpMs > 500} />
        <Metric label="CLS" value={c.clsValue !== null ? c.clsValue.toFixed(3) : '—'} good={c.clsValue !== null && c.clsValue <= 0.1} poor={c.clsValue !== null && c.clsValue > 0.25} />
      </View>
      {c.collectionPeriod && (
        <Text style={[styles.heroMeta, { marginTop: 6 }]}>
          Period: {c.collectionPeriod.from} → {c.collectionPeriod.to} (form factor: {c.formFactor.toLowerCase()})
        </Text>
      )}
    </View>
  )
}

function AiVisibilityCard({ snap }: { snap: DomainSnapshot }) {
  const ai = snap.ai
  if (!ai) {
    return (
      <SimpleCard
        title="AI Visibility (DataForSEO)"
        body="Skipped — no keywords passed. Pass top organic keywords to enable the AI Overview / Featured Snippet detection."
      />
    )
  }
  return (
    <View style={styles.card} wrap={false}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>AI Visibility (DataForSEO)</Text>
        <Text style={[styles.cardScore, { color: scoreColor(Math.round(ai.aiOverviewPercentage)) }]}>{Math.round(ai.aiOverviewPercentage)}%</Text>
      </View>
      <Row label="Keywords scanned" value={`${ai.successCount}/${ai.totalKeywords}`} />
      <Row label="With AI Overview" value={`${ai.aiOverviewCount} (${ai.aiOverviewPercentage}%)`} />
      <Row label="With Featured Snippet" value={String(ai.featuredSnippetCount)} />
      <Row label="With People Also Ask" value={String(ai.peopleAlsoAskCount)} />
      <Row label="Client in top 10" value={`${ai.clientTop10Count} keyword(s)`} />
      <Row label="Cost (USD)" value={`$${ai.totalCostUsd.toFixed(4)}`} />
    </View>
  )
}

function MarTechCard({ snap }: { snap: DomainSnapshot }) {
  const t = snap.tech
  if (!t || !t.ok) return <SimpleCard title="MarTech Stack" body={t?.error ?? 'Not available'} />
  const cats = Object.entries(t.byCategory).sort(([, a], [, b]) => b - a)
  return (
    <View style={styles.card} wrap={false}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>MarTech Stack</Text>
        <Text style={[styles.cardScore, { color: COLORS.lime }]}>{t.technologies.length}</Text>
      </View>
      <Text style={[styles.cardBody, { marginBottom: 4 }]}>
        {t.technologies.length} tech in {cats.length} categories
      </Text>
      {cats.map(([cat, count]) => (
        <View key={cat} style={{ marginTop: 6 }}>
          <Text style={styles.sectionLabel}>{cat} ({count})</Text>
          <View style={styles.pillContainer}>
            {t.technologies
              .filter((tt) => tt.category === cat)
              .map((tt) => (
                <Text key={tt.name} style={styles.pill}>
                  {tt.name}
                  {tt.version ? ` v${tt.version}` : ''}
                </Text>
              ))}
          </View>
        </View>
      ))}
    </View>
  )
}

function WhoisCard({ snap }: { snap: DomainSnapshot }) {
  const w = snap.whois
  if (!w || !w.ok) return <SimpleCard title="Domain Identity (WHOIS)" body={w?.error ?? 'Not available'} />
  return (
    <View style={styles.card} wrap={false}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Domain Identity (WHOIS)</Text>
        <Text style={[styles.cardScore, { color: COLORS.lime }]}>{w.ageYears ?? '—'}y</Text>
      </View>
      <Row label="Domain age" value={w.ageYears !== null ? `${w.ageYears} years` : '—'} />
      <Row label="Registered" value={w.registrationDate ? fmtDate(w.registrationDate) : '—'} />
      <Row label="Expires" value={w.expirationDate ? fmtDate(w.expirationDate) : '—'} bad={w.daysToExpiry !== null && w.daysToExpiry < 60} />
      <Row label="Days to renewal" value={w.daysToExpiry !== null ? `${w.daysToExpiry}d` : '—'} bad={w.daysToExpiry !== null && w.daysToExpiry < 60} />
      <Row label="Registrar" value={w.registrar ?? '—'} />
      {w.nameservers.length > 0 && (
        <Row label="Nameservers" value={w.nameservers.slice(0, 2).join(', ') + (w.nameservers.length > 2 ? '...' : '')} />
      )}
    </View>
  )
}

function ErrorsCard({ errors }: { errors: DomainSnapshot['errors'] }) {
  return (
    <View style={[styles.card, { borderColor: COLORS.yellow }]} wrap={false}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: COLORS.yellow }]}>Provider errors ({errors.length})</Text>
      </View>
      {errors.map((e, i) => (
        <Text key={i} style={[styles.cardBody, { fontSize: 9, marginBottom: 2 }]}>
          <Text style={{ color: COLORS.textPrimary }}>{e.provider}:</Text>
          <Text style={{ color: COLORS.textMuted }}> {e.message}</Text>
        </Text>
      ))}
    </View>
  )
}

// =========================================================================
// Building blocks
// =========================================================================

function SimpleCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.card} wrap={false}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <Text style={[styles.cardBody, { color: COLORS.textMuted }]}>{body}</Text>
    </View>
  )
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={bad ? styles.rowValueBad : styles.rowValue}>{value}</Text>
    </View>
  )
}

function Metric({ label, value, good, poor }: { label: string; value: string; good?: boolean; poor?: boolean }) {
  const color = good ? COLORS.green : poor ? COLORS.red : COLORS.yellow
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  )
}

// =========================================================================
// Helpers
// =========================================================================

function scoreColor(score: number | null): string {
  if (score === null) return COLORS.textMuted
  if (score >= 80) return COLORS.green
  if (score >= 60) return COLORS.lime
  if (score >= 40) return COLORS.yellow
  return COLORS.red
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return iso
  }
}
