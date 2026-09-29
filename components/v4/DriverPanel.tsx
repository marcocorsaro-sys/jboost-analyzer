'use client'

/**
 * V4 — one driver tab of the results screen, in the 5 golden-standard
 * sections of README 01 §6:
 *
 *   (1) Score (client + competitors, raw under the score)
 *   (2) Summary (LLM insight comment per view; analyst comment as fallback)
 *   (3) Data: competitor HISTOGRAM (Bibbia sheet 6 v5) + evidence tables
 *   (4) Issues (3-5, from the LLM insight)
 *   (5) Solutions (3-5, from the LLM insight)
 *
 * THRESHOLD TRANSPARENCY (README 01 §6): a number never appears without its
 * criterion. Discoverability shows the tier + thresholds next to the score;
 * Awareness shows the counting basis and the brand terms used.
 *
 * Null discipline: null renders as "—", never 0. A driver in error renders
 * the reason the source gave, never an empty card.
 */

import { useState } from 'react'
import nextDynamic from 'next/dynamic'
import { useLocale } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import { getV4Driver, DISCO_TIERS } from '@/lib/scoring/registry'
import { DriverEditor, DecisionForm, fmt, STATUS_STYLE, type DriverRow, type SiteScore } from './RunProgress'
import ContentQuestionnaire from './ContentQuestionnaire'
import type { InsightRecord, SiteMeta, DevInsightItem, BusinessInsightItem } from './results-shared'
import {
  card,
  sectionTitle,
  mutedLabel,
  pill,
  fill,
  scoreColor,
  MEASURE_LABEL_KEY,
  PRIORITY_COLORS,
  ghostButton,
  primaryButton,
} from './results-shared'
import type { HistogramSite } from './charts/V4Histogram'
import { B } from '@/lib/brand'

// recharts stays in its own lazy chunk (same pattern as the V1 SpiderChart).
const V4Histogram = nextDynamic(() => import('./charts/V4Histogram'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 300, background: B.surface, borderRadius: B.radius.card, border: `1px solid ${B.border}` }} aria-hidden />
  ),
})

export type ScoreView = 'relative' | 'absolute'

interface DriverPanelProps {
  analysisId: string
  row: DriverRow
  view: ScoreView
  sites: SiteMeta[]
  insight: InsightRecord | null
  insightsRunning: boolean
  onGenerateInsights: () => void
  /** Targeted generation (review 3/13): insight of THIS driver only. */
  onGenerateDriverInsight: () => void
  onChanged: () => void
}

export default function DriverPanel({
  analysisId,
  row,
  view,
  sites,
  insight,
  insightsRunning,
  onGenerateInsights,
  onGenerateDriverInsight,
  onChanged,
}: DriverPanelProps) {
  const { t } = useLocale()
  const def = getV4Driver(row.driver_key)
  const [editing, setEditing] = useState(false)

  const effectiveView: ScoreView = view === 'absolute' && !def?.hasAbsoluteView ? 'relative' : view
  const clientSite = row.sites.find((s) => s.site_ref === 'client')

  const scoreOf = (s: SiteScore): number | null =>
    effectiveView === 'absolute' ? (s.score_absolute ?? null) : (s.score_relative ?? null)

  const headlineScore =
    effectiveView === 'absolute' ? row.score_absolute : row.score_relative

  const output = insight?.status === 'done' ? insight.output : null

  // ---- single-driver relaunch ("Rilancia questo driver") -------------------
  // done rows need force + an inline confirm (the re-measure is destructive:
  // it replaces the data with today's — edits and decisions taken survive).
  const [retryOpen, setRetryOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryNote, setRetryNote] = useState<string | null>(null)
  const canRetry = row.status === 'done' || row.status === 'error' || row.status === 'queued'

  const retryThisDriver = async (force: boolean) => {
    setRetrying(true)
    setRetryNote(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver: row.driver_key, ...(force ? { force: true } : {}) }),
      })
      const body = await res.json()
      if (!res.ok && res.status !== 207) {
        setRetryNote(body.error ?? `errore ${res.status}`)
        return
      }
      if (Array.isArray(body.dispatchErrors) && body.dispatchErrors.length > 0) {
        setRetryNote(body.dispatchErrors.join(' | '))
      }
      setRetryOpen(false)
      onChanged()
    } catch (err) {
      setRetryNote(err instanceof Error ? err.message : 'network error')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ------------------------------------------------ 1 · SCORE ------- */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h3 style={{ ...sectionTitle, margin: 0 }}>
            {def?.label ?? row.driver_key} · {t('v4res.sec_score')}
          </h3>
          <span style={pill(STATUS_STYLE[row.status].color)}>{STATUS_STYLE[row.status].label}</span>
          <span style={pill(B.muted)}>
            {t(def?.family === 'business' ? 'v4res.family_business' : 'v4res.family_development')}
          </span>
          {row.edited && <span style={pill(B.warning)}>{t('v4res.edited_badge')}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canRetry && (
              <button
                type="button"
                onClick={() => {
                  if (row.status === 'done') setRetryOpen(!retryOpen)
                  else void retryThisDriver(false)
                }}
                disabled={retrying}
                style={{ ...ghostButton, color: retrying ? B.muted : B.muted }}
                title={t('v4res.retry_hint')}
              >
                {retrying ? t('v4res.retrying') : t('v4res.retry_driver')}
              </button>
            )}
            {row.status === 'done' && (
              // Review item 11 (CRITICAL): the edit affordance must be
              // explicit, a labelled button in primary color, never only an
              // icon. It opens the existing DriverEditor unchanged.
              <button
                type="button"
                onClick={() => setEditing(!editing)}
                style={{ ...ghostButton, borderColor: `${B.primary}55`, color: B.primary, fontWeight: 650 }}
              >
                {editing ? t('v4res.close') : `✎ ${t('v4res.edit_button')}`}
              </button>
            )}
          </span>
        </div>

        {/* Inline confirm: re-measuring a done driver replaces its data with
            today's — never on a single click. Edits and decisions survive. */}
        {retryOpen && row.status === 'done' && (
          <div
            style={{
              marginTop: '12px',
              padding: '10px 14px',
              background: `${B.warning}15`,
              border: `1px solid ${B.warning}40`,
              borderRadius: '8px',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '15px', color: B.warning }}>{t('v4res.retry_driver_confirm')}</span>
            <button
              type="button"
              onClick={() => void retryThisDriver(true)}
              disabled={retrying}
              style={primaryButton(!retrying)}
            >
              {retrying ? t('v4res.retrying') : t('v4res.retry_driver_yes')}
            </button>
            <button type="button" onClick={() => setRetryOpen(false)} style={ghostButton}>
              {t('v4res.retry_driver_no')}
            </button>
          </div>
        )}
        {retryNote && (
          <div style={{ marginTop: '10px', fontSize: '14px', color: B.warning }}>{retryNote}</div>
        )}

        {view === 'absolute' && !def?.hasAbsoluteView && (
          <div style={{ marginTop: '10px', fontSize: '14px', color: B.warning }}>
            {t('v4res.relative_only_note')}
          </div>
        )}

        {row.status === 'error' ? (
          <div
            style={{
              marginTop: '14px',
              padding: '12px 16px',
              background: `${B.error}15`,
              border: `1px solid ${B.error}40`,
              borderRadius: '8px',
            }}
          >
            <div style={{ ...mutedLabel, color: B.error, marginBottom: '4px' }}>{t('v4res.driver_error')}</div>
            <div style={{ fontSize: '15px', color: B.error, lineHeight: 1.5 }}>{row.error ?? '—'}</div>
          </div>
        ) : row.status === 'queued' || row.status === 'running' ? (
          <PendingInfo row={row} />
        ) : (
          <div style={{ marginTop: '16px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            {/* Client headline: the big score NEVER without its view label —
                a Relative 100 is a set comparison, not an absolute grade. */}
            <ScoreHeadline
              label={sites.find((s) => s.is_client)?.name ?? t('v4res.client')}
              driverKey={row.driver_key}
              view={effectiveView}
              score={headlineScore}
              raw={row.raw_value}
              rank={clientSite?.rank ?? null}
              setSize={row.sites.length}
            />
            {/* Competitor chips, side by side (sheet 6 B.6). */}
            {row.sites
              .filter((s) => s.site_ref !== 'client')
              .map((s) => (
                <ScoreChip
                  key={s.site_ref}
                  label={sites.find((m) => m.site_ref === s.site_ref)?.name ?? s.domain}
                  score={scoreOf(s)}
                  raw={s.raw}
                  rank={s.rank ?? null}
                  isClient={false}
                  rawLabel={t('v4res.raw')}
                  leaderLabel={t('v4res.leader')}
                />
              ))}
          </div>
        )}

        {/* Copertura parziale dichiarata (Sprint 1 item 4a): nota ambra come
            per la coverage note PSI, mai un numero senza il suo perimetro. */}
        {row.partial_note && row.status === 'done' && (
          <div
            style={{
              marginTop: '14px',
              padding: '10px 14px',
              background: `${B.warning}15`,
              border: `1px solid ${B.warning}40`,
              borderRadius: '8px',
              fontSize: '14px',
              color: B.warning,
              lineHeight: 1.5,
            }}
          >
            {t('v4res.partial_coverage')}: {row.partial_note}
          </div>
        )}

        {/* Fallback manuale Compliance (Sprint 1 item 4b): upload export
            Semrush per sito quando il driver è in errore o parziale. */}
        {row.driver_key === 'compliance' &&
          (row.status === 'error' || (row.status === 'done' && row.partial_note)) && (
            <ComplianceUploadBox
              analysisId={analysisId}
              row={row}
              sites={sites}
              onChanged={onChanged}
            />
          )}

        {/* Aggiorna dati J-Horizon (Sprint 1 item 3): sempre disponibile a
            driver misurato, anche quando il decision_request non esiste più. */}
        {row.driver_key === 'ai_visibility' && row.status === 'done' && (
          <JhorizonUpdateBox analysisId={analysisId} row={row} onChanged={onChanged} />
        )}

        {/* Threshold transparency — the number never without its criterion. */}
        <CriteriaCaption row={row} clientSite={clientSite} />

        {/* Setup uploads bound to this driver (Bibbia 04 fields #15/#20).
            Listed as evidence of what was provided; parsing is downstream. */}
        {(row.attachments?.length ?? 0) > 0 && (
          <div
            style={{
              marginTop: '12px',
              padding: '10px 14px',
              background: B.bg,
              border: `1px solid ${B.border}`,
              borderRadius: '8px',
            }}
          >
            <div style={{ ...mutedLabel, marginBottom: '6px' }}>{t('v4res.attachments')}</div>
            {row.attachments!.map((a) => (
              <div key={a.path ?? a.name} style={{ fontSize: '15px', color: B.ink, lineHeight: 1.7 }}>
                {a.name}
                <span style={{ color: B.muted, marginLeft: '8px', fontSize: '14px' }}>
                  {typeof a.parsed?.row_count === 'number'
                    ? fill(t('v4res.attachment_parsed'), { n: a.parsed.row_count })
                    : t('v4res.attachment_pending')}
                </span>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <DriverEditor
            row={row}
            analysisId={analysisId}
            onSaved={() => {
              setEditing(false)
              onChanged()
            }}
          />
        )}

        {row.status === 'needs_decision' && row.driver_key !== 'content' && (
          <DecisionForm row={row} analysisId={analysisId} onAnswered={onChanged} />
        )}
      </div>

      {/* ------------------------------------------------ 2 · SUMMARY ----- */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h3 style={{ ...sectionTitle, margin: 0 }}>{t('v4res.sec_summary')}</h3>
          {insight?.status === 'done' && insight.hallucination_flags && insight.hallucination_flags.length > 0 && (
            <span style={pill(B.warning)} title={insight.hallucination_flags.join(', ')}>
              ⚠ {t('v4res.hallucination_flags')}: {insight.hallucination_flags.slice(0, 4).join(', ')}
              {insight.hallucination_flags.length > 4 ? '…' : ''}
            </span>
          )}
        </div>
        <SummaryBody
          row={row}
          output={output}
          insight={insight}
          effectiveView={effectiveView}
          insightsRunning={insightsRunning}
          onGenerateInsights={onGenerateInsights}
          onGenerateDriverInsight={onGenerateDriverInsight}
        />
      </div>

      {/* ------------------------------------------------ 3 · DATA -------- */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {row.driver_key === 'content' && (
          <ContentQuestionnaire
            analysisId={analysisId}
            sites={sites}
            driverStatus={row.status}
            onChanged={onChanged}
          />
        )}

        {row.sites.length > 0 && (
          <V4Histogram
            title={`${t('v4res.histogram_title')} · ${
              effectiveView === 'absolute' ? t('v4res.view_absolute') : t('v4res.view_relative')
            }`}
            sites={row.sites.map(
              (s): HistogramSite => ({
                name: sites.find((m) => m.site_ref === s.site_ref)?.name ?? s.domain,
                value: scoreOf(s),
                raw: s.raw,
                isClient: s.site_ref === 'client',
              }),
            )}
            notMeasuredLabel={t('v4res.not_measured')}
            rawLabel={t('v4res.raw')}
          />
        )}

        {row.sites.length > 0 && <EvidenceCard row={row} sites={sites} />}
      </div>

      {/* ------------------------------------------------ 4 · ISSUES ------ */}
      <div style={card}>
        <h3 style={sectionTitle}>{t('v4res.sec_issues')}</h3>
        <IssuesList output={output} family={def?.family ?? 'development'} />
      </div>

      {/* ------------------------------------------------ 5 · SOLUTIONS --- */}
      <div style={card}>
        <h3 style={sectionTitle}>{t('v4res.sec_solutions')}</h3>
        <SolutionsList output={output} family={def?.family ?? 'development'} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * The client's big score, with the view label ALWAYS visible and talking
 * (README 01 §6 threshold transparency, extended to the score itself):
 *
 *  Relative view:  100 · "Confronto col set — leader" (or "… — 74% del
 *                  leader"), and UNDER it the real measure line:
 *                  "Misura reale: 57 (PageSpeed performance medio)".
 *  Absolute view:  57 · "Misura reale (0-100)", and under it the position
 *                  in the set: "Nel set: leader" or "n° 2 di 3".
 *
 * The ⓘ tooltip carries the formula, so nobody can read a leader-index 100
 * as an absolute grade again (the Benetton PSI-57 lesson).
 */
function ScoreHeadline({
  label,
  driverKey,
  view,
  score,
  raw,
  rank,
  setSize,
}: {
  label: string
  driverKey: string
  view: ScoreView
  score: number | null
  raw: number | null
  rank: number | null
  setSize: number
}) {
  const { t } = useLocale()
  const measureKey = MEASURE_LABEL_KEY[driverKey]
  const measureLabel = measureKey ? t(measureKey) : driverKey

  const viewLabel =
    view === 'absolute'
      ? t('v4res.abs_label')
      : rank === 1 && score !== null
        ? t('v4res.rel_leader')
        : score !== null
          ? fill(t('v4res.rel_pct'), { pct: Math.round(Number(score)) })
          : t('v4res.view_relative')

  const subLine =
    view === 'absolute'
      ? `${measureLabel} · ${
          rank === 1
            ? t('v4res.in_set_leader')
            : rank !== null
              ? fill(t('v4res.in_set_rank'), { rank, n: setSize })
              : t('v4res.not_measured')
        }`
      : `${t('v4res.real_measure')}: ${fmt(raw)} (${measureLabel})`

  return (
    <div
      style={{
        border: `1px solid ${B.primary}33`,
        borderRadius: B.radius.card,
        padding: '24px 28px',
        minWidth: '300px',
        background: B.primarySoft,
        boxShadow: B.shadow.card,
      }}
    >
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...B.type.label, color: B.primary }}>{label}</span>
        {rank === 1 && <span style={pill(B.primary)}>{t('v4res.leader')}</span>}
      </div>
      <div style={{ display: 'flex', gap: '14px', alignItems: 'baseline', flexWrap: 'wrap', marginTop: '10px' }}>
        <span style={{ ...B.type.display, ...B.type.num, color: scoreColor(score) }}>{fmt(score)}</span>
        <span style={{ fontSize: '15px', fontWeight: 600, color: B.muted }}>
          {viewLabel}{' '}
          <span
            title={t('v4res.formula_note')}
            aria-label={t('v4res.formula_note')}
            style={{ cursor: 'help', color: B.muted }}
          >
            ⓘ
          </span>
        </span>
      </div>
      <div style={{ fontSize: '15px', color: B.ink, lineHeight: 1.5, marginTop: '10px' }}>{subLine}</div>
    </div>
  )
}

function ScoreChip({
  label,
  score,
  raw,
  rank,
  isClient,
  rawLabel,
  leaderLabel,
}: {
  label: string
  score: number | null
  raw: number | null | undefined
  rank: number | null
  isClient: boolean
  rawLabel: string
  leaderLabel: string
}) {
  return (
    <div
      style={{
        border: `1px solid ${isClient ? `${B.primary}33` : B.border}`,
        borderRadius: B.radius.card,
        padding: '20px 24px',
        minWidth: '170px',
        background: isClient ? B.primarySoft : B.bg,
        boxShadow: B.shadow.card,
      }}
    >
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...B.type.label, color: isClient ? B.primary : B.muted }}>{label}</span>
        {rank === 1 && <span style={pill(B.primary)}>{leaderLabel}</span>}
      </div>
      <div style={{ ...B.type.displaySm, ...B.type.num, color: scoreColor(score), marginTop: '8px' }}>
        {fmt(score)}
      </div>
      <div style={{ fontSize: '14px', color: B.muted, marginTop: '4px' }}>
        {rawLabel} {fmt(raw ?? null)}
      </div>
    </div>
  )
}

/**
 * The criterion caption (README 01 §6 "Trasparenza delle soglie").
 * Discoverability: tier + thresholds from the evidence (fallback: registry).
 * Awareness: counting basis + brand terms actually used.
 */
function CriteriaCaption({ row, clientSite }: { row: DriverRow; clientSite: SiteScore | undefined }) {
  const { t } = useLocale()

  if (row.driver_key === 'discoverability') {
    const ev = (clientSite?.evidence ?? {}) as {
      tier?: string
      tier_rule?: { position_max?: number; volume_min?: number }
    }
    const tierKey = ev.tier ?? row.tier_used ?? 'strict'
    const rule =
      ev.tier_rule && ev.tier_rule.position_max && ev.tier_rule.volume_min
        ? { pos: ev.tier_rule.position_max, vol: ev.tier_rule.volume_min }
        : (() => {
            const tier = DISCO_TIERS.find((x) => x.key === tierKey)
            return tier ? { pos: tier.pos, vol: tier.vol } : null
          })()
    return (
      <div style={{ marginTop: '12px', fontSize: '14px', color: B.muted }}>
        {rule ? fill(t('v4res.disco_criteria'), { pos: rule.pos, vol: rule.vol }) : ''}
        {' · '}
        {t('v4res.tier_label')}: <span style={{ color: B.primary }}>{tierKey}</span>
      </div>
    )
  }

  if (row.driver_key === 'awareness') {
    const ev = (clientSite?.evidence ?? {}) as { brand_terms?: string[] }
    return (
      <div style={{ marginTop: '12px', fontSize: '14px', color: B.muted }}>
        {t('v4res.awareness_criteria')}
        {Array.isArray(ev.brand_terms) && ev.brand_terms.length > 0 && (
          <>
            {' · '}
            {t('v4res.awareness_brand_terms')}:{' '}
            <span style={{ color: B.primary }}>{ev.brand_terms.join(', ')}</span>
          </>
        )}
      </div>
    )
  }

  return null
}

function SummaryBody({
  row,
  output,
  insight,
  effectiveView,
  insightsRunning,
  onGenerateInsights,
  onGenerateDriverInsight,
}: {
  row: DriverRow
  output: Record<string, unknown> | null
  insight: InsightRecord | null
  effectiveView: ScoreView
  insightsRunning: boolean
  onGenerateInsights: () => void
  onGenerateDriverInsight: () => void
}) {
  const { t } = useLocale()

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

  // Insight degradato (Sprint 1 item 2c): niente JSON valido ma testo
  // utilizzabile — si mostra il testo grezzo con la nota ambra e il bottone
  // di rigenerazione resta disponibile.
  const degraded = insight?.status === 'done' && insight.json_degraded === true

  // LLM comment for the current view; analyst comment as fallback; then
  // the explicit placeholder + "generate" CTA — never a silent blank.
  const llmComment = output
    ? degraded
      ? str(output.summary)
      : effectiveView === 'absolute'
        ? (str(output.commento_absolute) ?? str(output.commento_relative))
        : (str(output.commento_relative) ?? str(output.commento_absolute))
    : null
  const analystComment =
    effectiveView === 'absolute'
      ? (row.comment_absolute ?? row.comment_relative)
      : (row.comment_relative ?? row.comment_absolute)

  const comment = llmComment ?? analystComment

  const extras = output
    ? [str(output.ranking_summary), str(output.trend_summary), str(output.competitor_benchmark_summary)].filter(
        (x): x is string => x !== null,
      )
    : []

  // Ghost CTA, review 3/13: generate (or regenerate) the insight of THIS
  // driver only, near the existing insight or in its place when absent.
  const driverInsightButton = row.status === 'done' && (
    <button
      type="button"
      onClick={onGenerateDriverInsight}
      disabled={insightsRunning}
      style={{ ...ghostButton, alignSelf: 'flex-start', opacity: insightsRunning ? 0.6 : 1 }}
    >
      {insightsRunning
        ? t('v4res.gen_insights_running')
        : output
          ? t('v4res.regen_driver_insight')
          : t('v4res.gen_driver_insight')}
    </button>
  )

  if (insight?.status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '15px', color: B.error, lineHeight: 1.5 }}>
          {t('v4res.insights_error')}: {insight.error}
        </div>
        {driverInsightButton}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {degraded && (
        <div
          style={{
            padding: '8px 12px',
            background: `${B.warning}15`,
            border: `1px solid ${B.warning}40`,
            borderRadius: '8px',
            fontSize: '14px',
            color: B.warning,
            alignSelf: 'flex-start',
          }}
        >
          {t('v4res.insight_degraded')}
        </div>
      )}
      {comment ? (
        <div style={{ fontSize: '16px', color: B.ink, lineHeight: 1.6, maxWidth: '75ch' }}>{comment}</div>
      ) : (
        <div style={{ fontSize: '15px', color: B.muted }}>{t('v4res.insights_placeholder')}</div>
      )}
      {extras.map((x, i) => (
        <div key={i} style={{ fontSize: '14px', color: B.muted, lineHeight: 1.5, maxWidth: '75ch' }}>
          {x}
        </div>
      ))}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        {!output && row.status === 'done' && (
          <button
            type="button"
            onClick={onGenerateInsights}
            disabled={insightsRunning}
            style={primaryButton(!insightsRunning)}
          >
            {insightsRunning ? t('v4res.gen_insights_running') : t('v4res.gen_insights')}
          </button>
        )}
        {driverInsightButton}
      </div>
    </div>
  )
}

function IssuesList({ output, family }: { output: Record<string, unknown> | null; family: string }) {
  const { t } = useLocale()
  const items = readItems(output, family, t('v4res.priority'), t('v4res.relevance'))

  if (items.length === 0) {
    return <div style={{ fontSize: '15px', color: B.muted }}>{t('v4res.no_issues')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {items.map((item, i) => (
        <div key={i} style={{ borderLeft: `3px solid ${B.border}`, paddingLeft: '18px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '17px', fontWeight: 650, color: B.ink }}>{item.titolo ?? '—'}</span>
            {item.badge && (
              <span style={pill(PRIORITY_COLORS[item.badge] ?? B.muted)}>
                {item.badgeLabel}: {item.badge}
              </span>
            )}
          </div>
          {item.spiegazione && (
            <div style={{ fontSize: '15px', color: B.muted, lineHeight: 1.6, marginTop: '4px', maxWidth: '75ch' }}>
              {item.spiegazione}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function SolutionsList({ output, family }: { output: Record<string, unknown> | null; family: string }) {
  const { t } = useLocale()

  if (family === 'business') {
    // Sheet 15 business schema has no per-item solution: the strategic
    // solutions are synthesised in the Executive Summary (sheet 16 C).
    return <div style={{ fontSize: '15px', color: B.muted, lineHeight: 1.6 }}>{t('v4res.solutions_business_note')}</div>
  }

  const items = (Array.isArray(output?.items) ? (output!.items as DevInsightItem[]) : []).filter(
    (x) => typeof x?.soluzione_proposta === 'string' && x.soluzione_proposta.trim() !== '',
  )

  if (items.length === 0) {
    return <div style={{ fontSize: '15px', color: B.muted }}>{t('v4res.no_issues')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {items.map((item, i) => (
        <div key={i} style={{ borderLeft: `3px solid ${B.primary}55`, paddingLeft: '18px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '17px', fontWeight: 650, color: B.ink }}>{item.titolo ?? '—'}</span>
            {item.priorita && (
              <span style={pill(PRIORITY_COLORS[item.priorita] ?? B.muted)}>
                {t('v4res.priority')}: {item.priorita}
              </span>
            )}
          </div>
          <div style={{ fontSize: '15px', color: B.muted, lineHeight: 1.6, marginTop: '4px', maxWidth: '75ch' }}>
            {item.soluzione_proposta}
          </div>
        </div>
      ))}
    </div>
  )
}

function readItems(
  output: Record<string, unknown> | null,
  family: string,
  priorityLabel: string,
  relevanceLabel: string,
): Array<{ titolo?: string; spiegazione?: string; badge: string | null; badgeLabel: string }> {
  if (!output) return []
  if (family === 'business') {
    const list = Array.isArray(output.insights) ? (output.insights as BusinessInsightItem[]) : []
    return list.map((x) => ({
      titolo: x.titolo,
      spiegazione: x.spiegazione,
      badge: x.rilevanza_strategica ?? null,
      badgeLabel: relevanceLabel,
    }))
  }
  const list = Array.isArray(output.items) ? (output.items as DevInsightItem[]) : []
  return list.map((x) => ({
    titolo: x.titolo,
    spiegazione: x.spiegazione,
    badge: x.priorita ?? null,
    badgeLabel: priorityLabel,
  }))
}

// ---------------------------------------------------------------------------
// Evidence — generic renderer for SiteRawValue.evidence (scalars as rows,
// arrays of objects as tables). The criteria captions repeat here as table
// captions per the Bibbia ("show the thresholds as a caption on the data").
// ---------------------------------------------------------------------------

function EvidenceCard({ row, sites }: { row: DriverRow; sites: SiteMeta[] }) {
  const { t } = useLocale()
  const withEvidence = row.sites.filter((s) => s.evidence && Object.keys(s.evidence).length > 0)
  const [siteRef, setSiteRef] = useState<string>(
    withEvidence.find((s) => s.site_ref === 'client')?.site_ref ?? withEvidence[0]?.site_ref ?? 'client',
  )
  if (withEvidence.length === 0) return null
  const active = withEvidence.find((s) => s.site_ref === siteRef) ?? withEvidence[0]
  const evidence = (active.evidence ?? {}) as Record<string, unknown>

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <h4 style={{ ...sectionTitle, margin: 0 }}>{t('v4res.evidence_title')}</h4>
        {withEvidence.length > 1 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {withEvidence.map((s) => (
              <button
                key={s.site_ref}
                type="button"
                onClick={() => setSiteRef(s.site_ref)}
                style={{
                  ...ghostButton,
                  padding: '4px 10px',
                  borderColor: s.site_ref === active.site_ref ? B.primary : B.border,
                  color: s.site_ref === active.site_ref ? B.primary : B.muted,
                }}
              >
                {sites.find((m) => m.site_ref === s.site_ref)?.name ?? s.domain}
              </button>
            ))}
          </div>
        )}
      </div>
      <EvidenceBlock evidence={evidence} noValueLabel={t('v4res.no_value')} />
    </div>
  )
}

function EvidenceBlock({ evidence, noValueLabel }: { evidence: Record<string, unknown>; noValueLabel: string }) {
  const entries = Object.entries(evidence)
  const scalars = entries.filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
  const arrays = entries.filter(([, v]) => Array.isArray(v)) as Array<[string, unknown[]]>
  const objects = entries.filter(
    ([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v),
  ) as Array<[string, Record<string, unknown>]>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {scalars.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
          {scalars.map(([k, v]) => (
            <div key={k} style={{ fontSize: '14px' }}>
              <span style={{ color: B.muted }}>{k}: </span>
              <span style={{ color: B.ink }}>{v === null ? noValueLabel : String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {objects.map(([k, v]) => (
        <div key={k} style={{ fontSize: '14px' }}>
          <span style={{ color: B.muted }}>{k}: </span>
          <span style={{ color: B.ink, fontFamily: B.fontMono }}>
            {clip(JSON.stringify(v), 300)}
          </span>
        </div>
      ))}

      {arrays.map(([k, list]) => (
        <EvidenceArray key={k} name={k} list={list} noValueLabel={noValueLabel} />
      ))}
    </div>
  )
}

function EvidenceArray({ name, list, noValueLabel }: { name: string; list: unknown[]; noValueLabel: string }) {
  if (list.length === 0) return null

  const first = list[0]
  if (first === null || typeof first !== 'object') {
    return (
      <div style={{ fontSize: '14px' }}>
        <span style={{ color: B.muted }}>{name}: </span>
        <span style={{ color: B.ink }}>{list.slice(0, 12).map(String).join(', ')}{list.length > 12 ? '…' : ''}</span>
      </div>
    )
  }

  const rows = list.slice(0, 10) as Array<Record<string, unknown>>
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 6)

  return (
    <div>
      <div style={{ ...mutedLabel, marginBottom: '6px' }}>{name}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    color: B.muted,
                    borderBottom: `1px solid ${B.border}`,
                    fontSize: '13px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => {
                  const v = r[c]
                  return (
                    <td
                      key={c}
                      style={{ padding: '14px', color: B.ink, borderBottom: `1px solid ${B.surface2}` }}
                    >
                      {v === null || v === undefined
                        ? noValueLabel
                        : typeof v === 'object'
                          ? clip(JSON.stringify(v), 80)
                          : String(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > 10 && (
        <div style={{ fontSize: '14px', color: B.muted, marginTop: '4px' }}>+{list.length - 10}</div>
      )}
    </div>
  )
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

// ---------------------------------------------------------------------------
// Pending info (Sprint 1 item 1b): a running driver says HOW LONG it has been
// running; Speed/Accessibility say WHAT they are measuring; a recovered run
// shows "in coda (nuovo tentativo K di N)" instead of a mute IN CODA.
// ---------------------------------------------------------------------------

function PendingInfo({ row }: { row: DriverRow }) {
  const { t } = useLocale()

  const minutes =
    row.status === 'running' && row.started_at
      ? Math.max(0, Math.round((Date.now() - new Date(row.started_at).getTime()) / 60_000))
      : null

  const lines: string[] = []
  if (row.status === 'running' && minutes !== null) {
    lines.push(fill(t('v4res.running_since'), { n: minutes }))
  }
  if (row.status === 'queued' && row.attempts > 0) {
    lines.push(
      fill(t('v4res.queued_retry'), {
        k: Math.min(row.attempts + 1, row.max_attempts),
        n: row.max_attempts,
      }),
    )
  }
  if (
    (row.driver_key === 'speed' || row.driver_key === 'accessibility') &&
    row.psi_plan &&
    row.psi_plan.pages > 0
  ) {
    lines.push(fill(t('v4res.psi_running_note'), { p: row.psi_plan.pages, s: row.psi_plan.sites }))
  }

  return (
    <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ fontSize: '15px', color: B.teal }}>{t('v4res.driver_pending')}</div>
      {lines.map((line, i) => (
        <div key={i} style={{ fontSize: '14px', color: B.muted, lineHeight: 1.5 }}>
          {line}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aggiorna dati J-Horizon (Sprint 1 item 3): copy-prompt rigenerato lato
// server (buildJhorizonPrompt sui siti correnti, via status route), textarea
// per il nuovo paste, e un solo bottone che salva il paste come
// decision_taken E forza la rimisura — la retry route estesa
// ({driver:'ai_visibility', force:true, jhorizon_answer}) scrive il paste
// PRIMA del reset, così la rimisura lo legge come una risposta di pausa.
// ---------------------------------------------------------------------------

function JhorizonUpdateBox({
  analysisId,
  row,
  onChanged,
}: {
  analysisId: string
  row: DriverRow
  onChanged: () => void
}) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver: 'ai_visibility',
          force: true,
          jhorizon_answer: paste.trim(),
        }),
      })
      const body = await res.json()
      if (!res.ok && res.status !== 207) {
        setNote(body.error ?? `errore ${res.status}`)
        return
      }
      if (Array.isArray(body.dispatchErrors) && body.dispatchErrors.length > 0) {
        setNote(body.dispatchErrors.join(' | '))
      }
      setPaste('')
      setOpen(false)
      onChanged()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'errore di rete')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: '14px' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ ...ghostButton, borderColor: `${B.primary}55`, color: B.primary }}
      >
        {open ? `− ${t('v4res.jh_update_title')}` : `+ ${t('v4res.jh_update_title')}`}
      </button>
      {open && (
        <div
          style={{
            marginTop: '12px',
            padding: '18px',
            background: B.surface,
            border: `1px solid ${B.border}`,
            borderRadius: B.radius.control,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '14px', color: B.muted, lineHeight: 1.5, maxWidth: '75ch' }}>
            {t('v4res.jh_update_hint')}
          </div>
          {row.jhorizon_prompt && (
            <>
              <textarea
                readOnly
                value={row.jhorizon_prompt}
                style={{
                  width: '100%',
                  minHeight: '72px',
                  padding: '10px 14px',
                  background: B.bg,
                  border: `1px solid ${B.border}`,
                  borderRadius: '8px',
                  color: B.muted,
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
              <button
                type="button"
                style={{ ...ghostButton, alignSelf: 'flex-start' }}
                onClick={() => {
                  navigator.clipboard?.writeText(row.jhorizon_prompt ?? '').then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  })
                }}
              >
                {copied ? t('v4res.jh_copied') : t('v4res.jh_copy_prompt')}
              </button>
            </>
          )}
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={t('v4res.jh_paste_placeholder')}
            style={{
              width: '100%',
              minHeight: '120px',
              padding: '10px 14px',
              background: B.bg,
              border: `1px solid ${B.border}`,
              borderRadius: '8px',
              color: B.ink,
              fontSize: '15px',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
          <button
            type="button"
            disabled={busy || paste.trim().length < 20}
            onClick={() => void submit()}
            style={{
              ...primaryButton(!busy && paste.trim().length >= 20),
              alignSelf: 'flex-start',
            }}
          >
            {busy ? t('v4res.jh_saving') : t('v4res.jh_save_remeasure')}
          </button>
          {note && <div style={{ fontSize: '14px', color: B.warning }}>{note}</div>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compliance — upload export Semrush per sito (Sprint 1 item 4b): visibile a
// driver in errore o con copertura parziale. L'upload passa dalla files
// route (kind 'compliance_semrush', aperta anche post-lancio) e al termine
// forza la rimisura del solo driver Compliance.
// ---------------------------------------------------------------------------

function ComplianceUploadBox({
  analysisId,
  row,
  sites,
  onChanged,
}: {
  analysisId: string
  row: DriverRow
  sites: SiteMeta[]
  onChanged: () => void
}) {
  const { t } = useLocale()
  const [siteRef, setSiteRef] = useState<string>(sites[0]?.site_ref ?? 'client')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const upload = async (file: File) => {
    setBusy(true)
    setNote(null)
    try {
      const form = new FormData()
      form.set('kind', 'compliance_semrush')
      form.set('site_ref', siteRef)
      form.set('file', file)
      const res = await fetch(`/api/v4/analyses/${analysisId}/files`, {
        method: 'POST',
        body: form,
      })
      const body = await res.json()
      if (!res.ok) {
        setNote(body.error ?? `errore ${res.status}`)
        return
      }
      setNote(t('v4res.compliance_upload_done'))
      // Rimisura forzata del solo driver: il meccanismo single-retry
      // esistente (force sui done, diretto sugli error).
      const retryRes = await fetch(`/api/v4/analyses/${analysisId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver: 'compliance',
          ...(row.status === 'done' ? { force: true } : {}),
        }),
      })
      const retryBody = await retryRes.json()
      if (!retryRes.ok && retryRes.status !== 207) {
        setNote(retryBody.error ?? `errore ${retryRes.status}`)
        return
      }
      onChanged()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'errore di rete')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        marginTop: '14px',
        padding: '18px',
        background: B.surface,
        border: `1px dashed ${B.border}`,
        borderRadius: B.radius.control,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div style={{ fontSize: '15px', fontWeight: 650, color: B.ink }}>
        {t('v4res.compliance_upload_title')}
      </div>
      <div style={{ fontSize: '14px', color: B.muted, lineHeight: 1.5, maxWidth: '75ch' }}>
        {t('v4res.compliance_upload_hint')}
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '14px', color: B.muted }}>
          {t('v4res.compliance_upload_site')}
        </label>
        <select
          value={siteRef}
          onChange={(e) => setSiteRef(e.target.value)}
          style={{
            padding: '8px 12px',
            background: B.bg,
            border: `1px solid ${B.border}`,
            borderRadius: '8px',
            color: B.ink,
            fontSize: '14px',
            fontFamily: 'inherit',
          }}
        >
          {sites.map((s) => (
            <option key={s.site_ref} value={s.site_ref}>
              {s.name} ({s.domain})
            </option>
          ))}
        </select>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ''
          }}
          style={{ fontSize: '14px', color: B.muted }}
        />
        {busy && <span style={{ fontSize: '14px', color: B.teal }}>{t('v4res.compliance_uploading')}</span>}
      </div>
      {note && <div style={{ fontSize: '14px', color: B.warning }}>{note}</div>}
    </div>
  )
}
