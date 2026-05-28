'use client'

import { useState } from 'react'

// Schema Radiography main panel — the big three numbers up top, then a card
// per template (with per-template ↻ refresh), opportunities, OpenGraph
// summary, and pages-analyzed roll-up. A click on a template card opens the
// detail dialog with the LLM-drafted JSON-LD ready to paste.

interface MissingProp { key: string; why: string }
interface EnrichmentProperty {
  key: string
  tier: 'required' | 'recommended_google' | 'recommended_schema'
  why: string
  draftValue: unknown
  rationale: string
}
export interface TemplateReport {
  type: string
  label: string
  pageRole: string
  pageRoleLabel: string
  occurrences: number
  pagesCrawled: number
  score: number
  projectedScore: number
  projectedDelta: number
  presentProperties: string[]
  missingRequired: MissingProp[]
  missingRecommendedGoogle: MissingProp[]
  missingRecommendedSchema: MissingProp[]
  sampleUrl: string
  sampleRaw: Record<string, unknown>
  enrichment: {
    rubricType: string
    properties: EnrichmentProperty[]
    readyToPaste: Record<string, unknown>
    usage: { input_tokens: number; output_tokens: number }
    error?: string
  } | null
}
export interface SchemaReport {
  version: 1
  generatedAt: string
  pagesAnalyzed: { url: string; role: string; jsonLdBlocks: number; openGraphTags: number; status: 'ok' | 'failed'; error?: string }[]
  totalBlocks: number
  templates: TemplateReport[]
  openGraph: {
    averageTags: number
    pagesWithFullOg: number
    missingByTag: Record<string, number>
  }
  overall: { currentScore: number; projectedScore: number; delta: number }
  pageRoleSummary: { role: string; label: string; pages: number; templatesCovered: number }[]
  opportunities: { rubricType: string; label: string; rationale: string; projectedScore: number; pagesEligible: number }[]
  usage: { enrichmentCalls: number; inputTokens: number; outputTokens: number }
  discovery: { source: 'sitemap' | 'homepage_only'; sitemapSize: number; requested: number; actuallyScraped: number }
}

interface Props {
  report: SchemaReport
  clientId: string
  /** Called when the parent should re-fetch (no full-page loading flicker). */
  onTemplateRefreshed: (updated: SchemaReport) => void
}

function scoreColor(s: number): string {
  if (s >= 85) return '#22c55e'
  if (s >= 65) return '#38bdf8'
  if (s >= 40) return '#f59e0b'
  return '#ef4444'
}

export default function SchemaRadiography({ report, clientId, onTemplateRefreshed }: Props) {
  const [openTemplateKey, setOpenTemplateKey] = useState<string | null>(null)
  const openTemplate = report.templates.find(t => `${t.type}::${t.pageRole}` === openTemplateKey) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* BIG NUMBERS */}
      <BigNumbersHeader overall={report.overall} pagesScraped={report.discovery.actuallyScraped} totalBlocks={report.totalBlocks} templates={report.templates.length} />

      {/* TEMPLATES */}
      <section>
        <SectionTitle>Template rilevati ({report.templates.length})</SectionTitle>
        {report.templates.length === 0 ? (
          <EmptyHint text="Nessun blocco JSON-LD riconosciuto. Lancia una radiografia o controlla il dominio." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {report.templates.map(t => (
              <TemplateCard
                key={`${t.type}::${t.pageRole}`}
                template={t}
                clientId={clientId}
                onOpen={() => setOpenTemplateKey(`${t.type}::${t.pageRole}`)}
                onRefreshed={(updated) => onTemplateRefreshed(updated)}
              />
            ))}
          </div>
        )}
      </section>

      {/* OPPORTUNITIES */}
      {report.opportunities.length > 0 && (
        <section>
          <SectionTitle>Opportunità — template assenti che potresti aggiungere</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {report.opportunities.map(o => (
              <div key={o.rubricType} style={{
                background: '#1a1c24',
                border: '1px solid #2a2d35',
                borderLeft: '3px solid #c8e64a',
                borderRadius: '10px',
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '14px', color: '#ffffff', fontWeight: 600 }}>
                    {o.label} <span style={{ color: '#6b7280', fontWeight: 400, fontSize: '12px' }}>· {o.rubricType}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>{o.rationale}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px' }}>Score proiettato</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '24px', fontWeight: 700, color: scoreColor(o.projectedScore) }}>
                    {o.projectedScore}<span style={{ fontSize: '14px', color: '#6b7280' }}>/100</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* OPENGRAPH */}
      <section>
        <SectionTitle>OpenGraph / Twitter Card</SectionTitle>
        <OpenGraphCard og={report.openGraph} pagesScraped={report.discovery.actuallyScraped} />
      </section>

      {/* PAGES ANALYZED */}
      <section>
        <SectionTitle>Pagine analizzate ({report.discovery.actuallyScraped})</SectionTitle>
        <div style={{ background: '#1a1c24', border: '1px solid #2a2d35', borderRadius: '10px', overflow: 'hidden' }}>
          {report.pageRoleSummary.map(s => (
            <div key={s.role} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '10px 16px',
              borderBottom: '1px solid #2a2d35',
              fontSize: '12px',
              color: '#9ca3af',
            }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#c8e64a', minWidth: '160px' }}>{s.label}</span>
              <span style={{ flex: 1 }}>{s.pages} pagine</span>
              <span style={{ color: '#6b7280' }}>{s.templatesCovered} template</span>
            </div>
          ))}
          <div style={{
            padding: '10px 16px',
            fontSize: '11px',
            color: '#6b7280',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            Sorgente: {report.discovery.source === 'sitemap' ? `sitemap (${report.discovery.sitemapSize} URL totali)` : 'sola homepage (sitemap non disponibile)'}
            {' · '}
            {report.totalBlocks} blocchi JSON-LD totali
          </div>
        </div>
      </section>

      {openTemplate && (
        <TemplateDialog
          template={openTemplate}
          onClose={() => setOpenTemplateKey(null)}
        />
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '12px',
      fontWeight: 700,
      color: '#c8e64a',
      textTransform: 'uppercase',
      letterSpacing: '1.5px',
      marginBottom: '12px',
    }}>{children}</h3>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{
      background: '#1a1c24',
      border: '1px solid #2a2d35',
      borderRadius: '10px',
      padding: '24px',
      textAlign: 'center',
      fontSize: '13px',
      color: '#6b7280',
    }}>{text}</div>
  )
}

// ---------------------------------------------------------------------------
// Big-numbers header
// ---------------------------------------------------------------------------

function BigNumbersHeader({
  overall,
  pagesScraped,
  totalBlocks,
  templates,
}: {
  overall: { currentScore: number; projectedScore: number; delta: number }
  pagesScraped: number
  totalBlocks: number
  templates: number
}) {
  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '14px',
      }}>
        <BigCard label="Score attuale" value={overall.currentScore} unit="/100" color={scoreColor(overall.currentScore)} subline={`${pagesScraped} pagine · ${totalBlocks} blocchi · ${templates} template`} />
        <BigCard label="Proiezione" value={overall.projectedScore} unit="/100" color={scoreColor(overall.projectedScore)} subline="se applichi tutte le proposte" />
        <BigCard label="Delta" value={overall.delta} unit="pt" color={overall.delta > 0 ? '#c8e64a' : '#6b7280'} subline="incremento atteso" prefix={overall.delta > 0 ? '+' : ''} />
      </div>
    </div>
  )
}

function BigCard({
  label,
  value,
  unit,
  color,
  subline,
  prefix = '',
}: {
  label: string
  value: number
  unit: string
  color: string
  subline: string
  prefix?: string
}) {
  return (
    <div style={{
      background: '#1a1c24',
      border: `1px solid ${color}30`,
      borderRadius: '14px',
      padding: '24px 28px',
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '11px',
        fontWeight: 700,
        color: '#c8e64a',
        textTransform: 'uppercase',
        letterSpacing: '1.5px',
        marginBottom: '12px',
      }}>{label}</div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '64px',
        fontWeight: 700,
        color,
        lineHeight: '1',
        letterSpacing: '-2px',
      }}>
        {prefix}{value}<span style={{ fontSize: '20px', color: '#6b7280', letterSpacing: 0 }}>{unit}</span>
      </div>
      <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '12px' }}>{subline}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Template card (with per-template refresh)
// ---------------------------------------------------------------------------

function TemplateCard({
  template: t,
  clientId,
  onOpen,
  onRefreshed,
}: {
  template: TemplateReport
  clientId: string
  onOpen: () => void
  onRefreshed: (updated: SchemaReport) => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  async function handleRefresh(e: React.MouseEvent) {
    e.stopPropagation()
    setRefreshing(true)
    setRefreshError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/schema/template-refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rubricType: t.type,
          pageRole: t.pageRole,
          sampleUrl: t.sampleUrl,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Refresh fallito')
      if (data.report) onRefreshed(data.report as SchemaReport)
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Refresh fallito')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
      style={{
        background: '#1a1c24',
        border: `1px solid ${refreshError ? '#ef4444' : '#2a2d35'}`,
        borderRadius: '12px',
        padding: '20px 24px',
        display: 'flex',
        gap: '24px',
        alignItems: 'center',
        cursor: 'pointer',
        opacity: refreshing ? 0.6 : 1,
        transition: 'opacity 0.2s, border-color 0.2s',
      }}
    >
      {/* Score block (big number) */}
      <div style={{ textAlign: 'center', minWidth: '110px' }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '44px',
          fontWeight: 700,
          color: scoreColor(t.score),
          lineHeight: '1',
        }}>{t.score}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: '#6b7280', marginTop: '4px', letterSpacing: '1px', textTransform: 'uppercase' }}>attuale</div>
      </div>

      <div style={{ fontSize: '24px', color: '#3a3d45' }}>→</div>

      <div style={{ textAlign: 'center', minWidth: '110px' }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '44px',
          fontWeight: 700,
          color: scoreColor(t.projectedScore),
          lineHeight: '1',
        }}>{t.projectedScore}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: '#c8e64a', marginTop: '4px', letterSpacing: '1px', textTransform: 'uppercase' }}>
          proiett. (+{t.projectedDelta})
        </div>
      </div>

      {/* Label + meta */}
      <div style={{ flex: 1 }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '15px',
          color: '#ffffff',
          fontWeight: 600,
        }}>
          {t.label}
          <span style={{ color: '#6b7280', fontWeight: 400, fontSize: '12px', marginLeft: '10px' }}>{t.type}</span>
        </div>
        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
          {t.pageRoleLabel} · su {t.occurrences}/{t.pagesCrawled} pagine
          {t.missingRequired.length > 0 && (
            <span style={{ color: '#ef4444', marginLeft: '10px', fontWeight: 600 }}>
              {t.missingRequired.length} Google REQUIRED mancanti
            </span>
          )}
        </div>
        {refreshError && (
          <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '6px' }}>{refreshError}</div>
        )}
      </div>

      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        title={`Rilancia solo ${t.label} (non ricarica la pagina)`}
        aria-label={`Rilancia ${t.label}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          background: refreshing ? '#2a2d35' : '#c8e64a14',
          border: `1px solid ${refreshing ? '#2a2d35' : '#c8e64a55'}`,
          borderRadius: '6px',
          color: refreshing ? '#6b7280' : '#c8e64a',
          padding: '6px 12px',
          fontSize: '11px',
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          cursor: refreshing ? 'default' : 'pointer',
        }}
      >
        <span className={refreshing ? 'animate-spin' : undefined} style={{ display: 'inline-block', fontSize: '13px', lineHeight: 1 }}>↻</span>
        {refreshing ? 'Rilancio…' : 'Rilancia'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OpenGraph summary card
// ---------------------------------------------------------------------------

function OpenGraphCard({
  og,
  pagesScraped,
}: {
  og: SchemaReport['openGraph']
  pagesScraped: number
}) {
  const missingKeys = Object.entries(og.missingByTag).filter(([, n]) => n > 0)
  return (
    <div style={{
      background: '#1a1c24',
      border: '1px solid #2a2d35',
      borderRadius: '12px',
      padding: '20px 24px',
      display: 'flex',
      gap: '24px',
      alignItems: 'center',
    }}>
      <div style={{ textAlign: 'center', minWidth: '110px' }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '44px',
          fontWeight: 700,
          color: og.pagesWithFullOg === pagesScraped ? '#22c55e' : og.pagesWithFullOg > pagesScraped / 2 ? '#38bdf8' : '#f59e0b',
          lineHeight: '1',
        }}>{og.pagesWithFullOg}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: '#6b7280', marginTop: '4px', letterSpacing: '1px', textTransform: 'uppercase' }}>pagine OG complete / {pagesScraped}</div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '13px', color: '#ffffff', fontWeight: 600 }}>OpenGraph — media {og.averageTags} tag/pagina</div>
        {missingKeys.length === 0 ? (
          <div style={{ fontSize: '12px', color: '#22c55e', marginTop: '6px' }}>Tutti i tag essenziali presenti su tutte le pagine.</div>
        ) : (
          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '6px' }}>
            Mancanti su almeno una pagina:{' '}
            {missingKeys.map(([k, n]) => (
              <span key={k} style={{ marginRight: '10px' }}>
                <code style={{ color: '#fcd34d' }}>{k}</code> <span style={{ color: '#6b7280' }}>({n})</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Template detail dialog
// ---------------------------------------------------------------------------

function TemplateDialog({ template: t, onClose }: { template: TemplateReport; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const ready = t.enrichment?.readyToPaste ?? t.sampleRaw
  const readyJson = JSON.stringify(ready, null, 2)
  const sampleJson = JSON.stringify(t.sampleRaw, null, 2)
  async function copy() {
    try {
      await navigator.clipboard.writeText(`<script type="application/ld+json">\n${readyJson}\n</script>`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
        padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#111318',
          border: '1px solid #2a2d35',
          borderRadius: '16px',
          maxWidth: '960px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '28px 32px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '18px', fontWeight: 700, color: '#ffffff' }}>
              {t.label} <span style={{ color: '#6b7280', fontWeight: 400, fontSize: '14px' }}>· {t.type}</span>
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
              {t.pageRoleLabel} · su {t.occurrences}/{t.pagesCrawled} pagine
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '20px' }}
            aria-label="Chiudi"
          >×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
          <BigCard label="Score attuale" value={t.score} unit="/100" color={scoreColor(t.score)} subline={`${t.presentProperties.length} proprietà presenti`} />
          <BigCard label="Score proiettato" value={t.projectedScore} unit="/100" color={scoreColor(t.projectedScore)} subline={`+${t.projectedDelta} se applichi la proposta`} />
        </div>

        {/* Missing properties */}
        {(t.missingRequired.length + t.missingRecommendedGoogle.length + t.missingRecommendedSchema.length) > 0 && (
          <section style={{ marginBottom: '24px' }}>
            <SectionTitle>Campi mancanti</SectionTitle>
            {t.missingRequired.length > 0 && (
              <MissingGroup title="Google REQUIRED" color="#ef4444" items={t.missingRequired} drafts={t.enrichment?.properties ?? []} />
            )}
            {t.missingRecommendedGoogle.length > 0 && (
              <MissingGroup title="Google raccomandati" color="#f59e0b" items={t.missingRecommendedGoogle} drafts={t.enrichment?.properties ?? []} />
            )}
            {t.missingRecommendedSchema.length > 0 && (
              <MissingGroup title="Schema.org raccomandati" color="#6b7280" items={t.missingRecommendedSchema} drafts={t.enrichment?.properties ?? []} />
            )}
          </section>
        )}

        {/* Ready-to-paste */}
        <section style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <SectionTitle>JSON-LD pronto da incollare</SectionTitle>
            <button
              type="button"
              onClick={copy}
              style={{
                background: '#c8e64a',
                color: '#111318',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 14px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                cursor: 'pointer',
              }}
            >{copied ? 'Copiato!' : 'Copia'}</button>
          </div>
          {t.enrichment?.error && (
            <div style={{ fontSize: '12px', color: '#ef4444', marginBottom: '8px' }}>
              Enrichment LLM non riuscito: {t.enrichment.error} — sotto vedi solo il JSON attuale.
            </div>
          )}
          <pre style={{
            background: '#0a0c10',
            border: '1px solid #2a2d35',
            borderRadius: '8px',
            padding: '14px 16px',
            fontSize: '12px',
            color: '#d1d5db',
            overflow: 'auto',
            margin: 0,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: '1.45',
            maxHeight: '420px',
          }}>{readyJson}</pre>
        </section>

        {/* Current sample (raw) */}
        <section>
          <SectionTitle>JSON-LD attuale (campionato da {t.sampleUrl})</SectionTitle>
          <pre style={{
            background: '#0a0c10',
            border: '1px solid #2a2d35',
            borderRadius: '8px',
            padding: '14px 16px',
            fontSize: '11px',
            color: '#9ca3af',
            overflow: 'auto',
            margin: 0,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: '1.45',
            maxHeight: '300px',
          }}>{sampleJson}</pre>
        </section>
      </div>
    </div>
  )
}

function MissingGroup({
  title,
  color,
  items,
  drafts,
}: {
  title: string
  color: string
  items: MissingProp[]
  drafts: EnrichmentProperty[]
}) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '10px',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        color,
        marginBottom: '6px',
      }}>{title} ({items.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {items.map((m) => {
          const draft = drafts.find(d => d.key === m.key)
          return (
            <div key={m.key} style={{
              background: '#1a1c24',
              border: '1px solid #2a2d35',
              borderRadius: '8px',
              padding: '10px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <code style={{ color: '#c8e64a', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px' }}>{m.key}</code>
                <span style={{ color: '#6b7280', fontSize: '11px' }}>{m.why}</span>
              </div>
              {draft && draft.draftValue !== null && (
                <div style={{ marginTop: '6px' }}>
                  <div style={{ fontSize: '10px', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>Bozza proposta</div>
                  <code style={{ display: 'block', background: '#0a0c10', padding: '6px 8px', borderRadius: '4px', fontSize: '11px', color: '#d1d5db', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {typeof draft.draftValue === 'string' ? draft.draftValue : JSON.stringify(draft.draftValue, null, 2)}
                  </code>
                  {draft.rationale && (
                    <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '4px', fontStyle: 'italic' }}>{draft.rationale}</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
