'use client'

/**
 * V4 — Executive Summary tab (Bibbia Drivers sheet 16 C output; UX-UI sheet
 * "Audit Results": summary + priorities in ONE tab, never split).
 *
 * Renders the stored analyses.v4_executive_summary record:
 * - alert_critici as a red banner (first: an alert ignored is an alert lost)
 * - headline_dominante as the hero
 * - scorecard_overview as the narrative block
 * - correlazioni_chiave as cards
 * - priorita_strategiche as a horizontal roadmap grouped by 3/6/12 months
 */

import { useLocale } from '@/lib/i18n'
import type { InsightRecord, ExecSummaryOutput } from './results-shared'
import { card, sectionTitle, mutedLabel, pill, primaryButton, PRIORITY_COLORS } from './results-shared'

interface ExecutiveSummaryTabProps {
  record: InsightRecord | null
  insightsRunning: boolean
  onGenerate: () => void
}

export default function ExecutiveSummaryTab({ record, insightsRunning, onGenerate }: ExecutiveSummaryTabProps) {
  const { t } = useLocale()

  if (!record) {
    return (
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.6 }}>{t('v4res.sum_placeholder')}</div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={insightsRunning}
          style={{ ...primaryButton(!insightsRunning), alignSelf: 'flex-start' }}
        >
          {insightsRunning ? t('v4res.gen_insights_running') : t('v4res.gen_insights')}
        </button>
      </div>
    )
  }

  if (record.status === 'error') {
    return (
      <div style={{ ...card, borderColor: '#ef444440' }}>
        <div style={{ fontSize: '13px', color: '#ef4444', lineHeight: 1.6 }}>
          {t('v4res.insights_error')}: {record.error}
        </div>
      </div>
    )
  }

  const out = record.output as ExecSummaryOutput
  const alerts = Array.isArray(out.alert_critici) ? out.alert_critici : []
  const correlations = Array.isArray(out.correlazioni_chiave) ? out.correlazioni_chiave : []
  const priorities = Array.isArray(out.priorita_strategiche) ? out.priorita_strategiche : []
  const horizons = [3, 6, 12]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Critical alerts — red banner (sheet 16 C alert_critici). */}
      {alerts.length > 0 && (
        <div
          style={{
            background: '#ef444415',
            border: '1px solid #ef4444',
            borderRadius: '12px',
            padding: '16px 20px',
          }}
        >
          <div style={{ ...mutedLabel, color: '#ef4444', marginBottom: '8px' }}>{t('v4res.sum_alerts')}</div>
          {alerts.map((a, i) => (
            <div key={i} style={{ fontSize: '13px', color: '#ef4444', lineHeight: 1.6 }}>
              • {a}
            </div>
          ))}
        </div>
      )}

      {/* Hero headline. */}
      <div style={card}>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '22px',
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1.4,
          }}
        >
          {out.headline_dominante ?? '—'}
        </div>
        {record.hallucination_flags && record.hallucination_flags.length > 0 && (
          <div style={{ marginTop: '10px' }}>
            <span style={pill('#f59e0b')}>
              ⚠ {t('v4res.hallucination_flags')}: {record.hallucination_flags.join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* Scorecard overview. */}
      {out.scorecard_overview && (
        <div style={card}>
          <h3 style={sectionTitle}>{t('v4res.sum_scorecard')}</h3>
          <div style={{ fontSize: '14px', color: '#e5e5e5', lineHeight: 1.7 }}>{out.scorecard_overview}</div>
        </div>
      )}

      {/* Key correlations as blocks. */}
      {correlations.length > 0 && (
        <div style={card}>
          <h3 style={sectionTitle}>{t('v4res.sum_correlations')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            {correlations.map((c, i) => (
              <div key={i} style={{ border: '1px solid #2a2d35', borderRadius: '10px', padding: '14px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', marginBottom: '6px' }}>
                  {c.titolo ?? '—'}
                </div>
                <div style={{ fontSize: '12px', color: '#a0a0a0', lineHeight: 1.6 }}>{c.spiegazione}</div>
                {Array.isArray(c.driver_coinvolti) && c.driver_coinvolti.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {c.driver_coinvolti.map((d) => (
                      <span key={d} style={pill('#14b8a6')}>
                        {d}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strategic priorities as a horizontal 3/6/12-month roadmap. */}
      {priorities.length > 0 && (
        <div style={card}>
          <h3 style={sectionTitle}>{t('v4res.sum_priorities')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
            {horizons.map((h) => {
              const inHorizon = priorities.filter((p) => (p.orizzonte_temporale_mesi ?? 12) === h)
              return (
                <div key={h} style={{ border: '1px solid #2a2d35', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ ...mutedLabel, color: '#c8e64a', marginBottom: '10px' }}>
                    {h} {t('v4res.sum_months')}
                  </div>
                  {inHorizon.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>—</div>
                  ) : (
                    inHorizon.map((p, i) => (
                      <div key={i} style={{ marginBottom: '14px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#ffffff' }}>{p.titolo}</span>
                          {p.impatto_atteso && (
                            <span style={pill(PRIORITY_COLORS[p.impatto_atteso] ?? '#6b7280')}>
                              {t('v4res.sum_impact')}: {p.impatto_atteso}
                            </span>
                          )}
                        </div>
                        {p.razionale && (
                          <div style={{ fontSize: '12px', color: '#a0a0a0', lineHeight: 1.6, marginTop: '4px' }}>
                            {p.razionale}
                          </div>
                        )}
                        {Array.isArray(p.driver_impattati) && p.driver_impattati.length > 0 && (
                          <div style={{ marginTop: '6px', fontSize: '11px', color: '#6b7280' }}>
                            {t('v4res.sum_drivers')}: {p.driver_impattati.join(', ')}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
