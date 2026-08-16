'use client'

/**
 * V4 Content questionnaire (Bibbia sheets 9a/9b, v5 UI rules):
 *
 * - each question is shown ONCE; beneath it a TAB strip with one tab per
 *   analyzed site (Client, Competitor 1..4) holds that site's A/B/C/D
 *   options — the analyst answers the same question per site by switching
 *   tabs;
 * - answer labels precede the text: A = Very bad, B = Bad, C = Good,
 *   D = Very good, with the full 9b description and its points;
 * - the client is MANDATORY, competitors are optional (Development driver);
 * - a live template_score preview is computed client-side with the same
 *   pure engine the worker uses (lib/v4/content/score) — the preview can
 *   never drift from the real score;
 * - saves are drafts (partial sets are legal); when the Content driver is
 *   paused on needs_decision and the client has a complete template, the
 *   analyst can answer the decision from here and the job restarts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import {
  CONTENT_BANK,
  ANSWER_LABELS,
  type ContentAnswerKey,
  type ContentTemplate,
} from '@/lib/v4/content/bank'
import { templateScore, band } from '@/lib/v4/content/score'
import type { SiteMeta } from './results-shared'
import { card, sectionTitle, mutedLabel, primaryButton, ghostButton, scoreColor } from './results-shared'

type AnswerMap = Record<string, Record<string, Record<number, ContentAnswerKey>>>
// site_ref -> template_key -> question id -> selected

interface ContentQuestionnaireProps {
  analysisId: string
  sites: SiteMeta[]
  /** Content driver_runs status ('needs_decision' unlocks the restart CTA). */
  driverStatus: string | null
  /** Called after a save or a decision, so the parent refreshes the run. */
  onChanged: () => void
}

export default function ContentQuestionnaire({
  analysisId,
  sites,
  driverStatus,
  onChanged,
}: ContentQuestionnaireProps) {
  const { t } = useLocale()
  const orderedSites = useMemo(
    () => [...sites].sort((a, b) => (a.is_client ? -1 : b.is_client ? 1 : a.site_ref.localeCompare(b.site_ref))),
    [sites],
  )

  const [templateKey, setTemplateKey] = useState<string>(CONTENT_BANK[0].key)
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const template: ContentTemplate =
    CONTENT_BANK.find((tp) => tp.key === templateKey) ?? CONTENT_BANK[0]

  // --- load previously saved answers (drafts included) --------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/v4/analyses/${analysisId}/content-answers`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as {
          answers: Array<{ site_ref: string; template_key: string; question_num: number; selected: string | null }>
        }
        if (cancelled) return
        const map: AnswerMap = {}
        for (const row of body.answers ?? []) {
          if (!row.selected) continue
          map[row.site_ref] = map[row.site_ref] ?? {}
          map[row.site_ref][row.template_key] = map[row.site_ref][row.template_key] ?? {}
          map[row.site_ref][row.template_key][row.question_num] = row.selected as ContentAnswerKey
        }
        setAnswers(map)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [analysisId])

  const select = useCallback(
    (siteRef: string, questionId: number, key: ContentAnswerKey) => {
      setAnswers((prev) => ({
        ...prev,
        [siteRef]: {
          ...(prev[siteRef] ?? {}),
          [templateKey]: { ...((prev[siteRef] ?? {})[templateKey] ?? {}), [questionId]: key },
        },
      }))
      setMessage(null)
    },
    [templateKey],
  )

  // --- live per-site preview (same engine as the worker) ------------------
  const preview = useMemo(() => {
    return orderedSites.map((site) => {
      const siteAnswers = answers[site.site_ref]?.[templateKey] ?? {}
      const answered = template.questions.filter((q) => siteAnswers[q.id]).length
      const total = template.questions.length
      if (answered === total && total > 0) {
        try {
          const scored = templateScore(templateKey, siteAnswers)
          return { site, answered, total, score: scored.score, band: band(scored.score) }
        } catch {
          /* fall through to incomplete */
        }
      }
      return { site, answered, total, score: null as number | null, band: null }
    })
  }, [orderedSites, answers, templateKey, template])

  const clientComplete = useMemo(() => {
    const client = orderedSites.find((s) => s.is_client)
    if (!client) return false
    const bySite = answers[client.site_ref] ?? {}
    return CONTENT_BANK.some((tp) => {
      const a = bySite[tp.key] ?? {}
      return tp.questions.length > 0 && tp.questions.every((q) => a[q.id])
    })
  }, [orderedSites, answers])

  // --- persistence --------------------------------------------------------
  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const errors: string[] = []
      let savedCount = 0
      for (const site of orderedSites) {
        const siteAnswers = answers[site.site_ref]?.[templateKey] ?? {}
        const entries = Object.entries(siteAnswers)
        if (entries.length === 0) continue
        const res = await fetch(`/api/v4/analyses/${analysisId}/content-answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            site_ref: site.site_ref,
            template_key: templateKey,
            answers: Object.fromEntries(entries),
          }),
        })
        const body = await res.json()
        if (!res.ok) errors.push(`${site.name}: ${body.error ?? res.status}`)
        else savedCount += 1
      }
      setMessage(
        errors.length > 0
          ? `${t('v4content.save_error')}: ${errors.join(' | ')}`
          : savedCount > 0
            ? t('v4content.saved')
            : t('v4content.save_error'),
      )
      if (errors.length === 0) onChanged()
    } catch (err) {
      setMessage(`${t('v4content.save_error')}: ${err instanceof Error ? err.message : 'network'}`)
    } finally {
      setSaving(false)
    }
  }

  const resumeDriver = async () => {
    setResuming(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/drivers/content/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: { reason: 'questionnaire_compiled' } }),
      })
      const body = await res.json()
      if (!res.ok) setMessage(body.error ?? 'error')
      else onChanged()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'network error')
    } finally {
      setResuming(false)
    }
  }

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <h4 style={sectionTitle}>{t('v4content.title')}</h4>
        <div style={{ fontSize: '12px', color: '#6b7280' }}>{t('v4content.subtitle')}</div>
      </div>

      {/* Template selector — the 9 templates of the bank. */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={mutedLabel}>{t('v4content.template')}</span>
        {CONTENT_BANK.map((tp) => (
          <button
            key={tp.key}
            type="button"
            onClick={() => setTemplateKey(tp.key)}
            style={{
              ...ghostButton,
              borderColor: tp.key === templateKey ? '#c8e64a' : '#2a2d35',
              color: tp.key === templateKey ? '#c8e64a' : '#a0a0a0',
            }}
          >
            {tp.label}
          </button>
        ))}
      </div>

      {/* Live per-site score preview. */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {preview.map(({ site, answered, total, score, band: b }) => (
          <div
            key={site.site_ref}
            style={{
              border: '1px solid #2a2d35',
              borderRadius: '8px',
              padding: '8px 12px',
              minWidth: '150px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#6b7280' }}>
              {site.is_client ? `${site.name} · ${t('v4content.client_required')}` : site.name}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
              <span style={{ fontSize: '18px', fontWeight: 700, color: scoreColor(score) }}>
                {score === null ? '—' : score}
              </span>
              <span style={{ fontSize: '11px', color: '#6b7280' }}>
                {score === null
                  ? `${answered}/${total} ${t('v4content.answered')}`
                  : b
                    ? t(`v4res.band_${b.toLowerCase()}` as TranslationKey)
                    : ''}
              </span>
            </div>
          </div>
        ))}
        <div style={{ alignSelf: 'center', fontSize: '11px', color: '#6b7280' }}>
          {t('v4content.client_required')} · {t('v4content.competitor_optional')}
        </div>
      </div>

      {template.description && (
        <div style={{ fontSize: '12px', color: '#a0a0a0', lineHeight: 1.5 }}>{template.description}</div>
      )}

      {!loaded ? (
        <div style={{ color: '#6b7280', fontSize: '13px' }}>{t('v4res.loading')}</div>
      ) : (
        template.questions.map((q) => (
          <QuestionBlock
            key={`${template.key}-${q.id}`}
            question={q}
            sites={orderedSites}
            selectedBySite={Object.fromEntries(
              orderedSites.map((s) => [s.site_ref, answers[s.site_ref]?.[templateKey]?.[q.id] ?? null]),
            )}
            onSelect={select}
            ptsLabel={t('v4content.pts')}
          />
        ))
      )}

      <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={save} disabled={saving} style={primaryButton(!saving)}>
          {saving ? t('v4content.saving') : t('v4content.save')}
        </button>
        {driverStatus === 'needs_decision' && (
          <>
            <button
              type="button"
              onClick={resumeDriver}
              disabled={resuming || !clientComplete}
              style={primaryButton(!resuming && clientComplete)}
            >
              {resuming ? t('v4content.resuming') : t('v4content.resume_driver')}
            </button>
            <span style={{ fontSize: '12px', color: '#f59e0b', maxWidth: '420px' }}>
              {t('v4content.resume_hint')}
            </span>
          </>
        )}
        {message && <span style={{ fontSize: '12px', color: '#a0a0a0' }}>{message}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One question: text shown once, per-site tab strip beneath it (9a v5).
// ---------------------------------------------------------------------------

function QuestionBlock({
  question,
  sites,
  selectedBySite,
  onSelect,
  ptsLabel,
}: {
  question: ContentTemplate['questions'][number]
  sites: SiteMeta[]
  selectedBySite: Record<string, ContentAnswerKey | null>
  onSelect: (siteRef: string, questionId: number, key: ContentAnswerKey) => void
  ptsLabel: string
}) {
  const [activeSite, setActiveSite] = useState<string>(sites[0]?.site_ref ?? 'client')
  const site = sites.find((s) => s.site_ref === activeSite) ?? sites[0]
  const selected = site ? selectedBySite[site.site_ref] : null

  return (
    <div style={{ border: '1px solid #2a2d35', borderRadius: '10px', padding: '16px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ ...mutedLabel, color: '#c8e64a' }}>
          Q{question.id} · {question.area} (w {question.weight})
        </span>
      </div>
      <div style={{ fontSize: '14px', color: '#ffffff', margin: '8px 0 12px 0', lineHeight: 1.5 }}>
        {question.question}
      </div>

      {/* Site tab strip. */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {sites.map((s) => {
          const answered = selectedBySite[s.site_ref] !== null
          const active = s.site_ref === activeSite
          return (
            <button
              key={s.site_ref}
              type="button"
              onClick={() => setActiveSite(s.site_ref)}
              style={{
                ...ghostButton,
                padding: '4px 12px',
                borderColor: active ? '#c8e64a' : '#2a2d35',
                color: active ? '#c8e64a' : answered ? '#14b8a6' : '#a0a0a0',
              }}
            >
              {s.name}
              {answered ? ` · ${selectedBySite[s.site_ref]}` : ''}
            </button>
          )
        })}
      </div>

      {/* A/B/C/D radio cards for the active site. */}
      {site && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
          {question.answers.map((opt) => {
            const isSelected = selected === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onSelect(site.site_ref, question.id, opt.key)}
                style={{
                  textAlign: 'left',
                  background: isSelected ? '#c8e64a12' : '#111318',
                  border: `1px solid ${isSelected ? '#c8e64a' : '#2a2d35'}`,
                  borderRadius: '8px',
                  padding: '12px',
                  cursor: 'pointer',
                  color: '#a0a0a0',
                }}
              >
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '6px' }}>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 700,
                      color: isSelected ? '#c8e64a' : '#ffffff',
                    }}
                  >
                    {opt.key} · {ANSWER_LABELS[opt.key]}
                  </span>
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>
                    {opt.points} {ptsLabel}
                  </span>
                </div>
                <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{opt.description}</div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
