'use client'

/**
 * V4 — AI Visibility detail: Sentiment · Citation rate & fonti · Market share.
 *
 * Per tab: the copyable prompt (default, editable), a paste/upload area for
 * the answer, and the reading of that answer. A figure the answer did not
 * contain is shown as "dato mancante" — never as 0 and never estimated;
 * sources are only those present in the pasted text. Persistence and the
 * single LLM reading live behind /api/v4/analyses/[id]/ai-visibility.
 */

import { useCallback, useEffect, useState } from 'react'
import type React from 'react'
import { useLocale } from '@/lib/i18n'
import { B } from '@/lib/brand'
import {
  AI_TAB_KEYS,
  AI_TAB_LABELS,
  type AiTabKey,
  type CitationSite,
  type MarketShareSite,
  type SentimentSite,
  type StoredTab,
  type StoredTabs,
} from '@/lib/v4/ai-visibility-tabs'
import { card, sectionTitle, ghostButton, primaryButton, pill } from './results-shared'

interface SiteLite {
  site_ref: string
  domain: string
  name: string
  is_client: boolean
}

interface TabsResponse {
  sites: SiteLite[]
  tabs: StoredTabs
  defaults: Record<AiTabKey, string>
}

const cell: React.CSSProperties = {
  padding: '10px 12px',
  borderTop: `1px solid ${B.border}`,
  verticalAlign: 'top',
  fontSize: '14px',
  color: B.ink,
}

const textarea: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${B.border}`,
  borderRadius: B.radius.control,
  padding: '10px 12px',
  fontSize: '14px',
  lineHeight: 1.5,
  color: B.ink,
  background: B.bg,
  fontFamily: 'inherit',
  resize: 'vertical',
}

export default function AiVisibilityTabs({ analysisId }: { analysisId: string }) {
  const { t } = useLocale()
  const [data, setData] = useState<TabsResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [active, setActive] = useState<AiTabKey>('sentiment')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/ai-visibility`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) {
        setLoadError(body.error ?? `errore ${res.status}`)
        return
      }
      setData(body as TabsResponse)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'network error')
    }
  }, [analysisId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div style={card}>
      <h4 style={{ ...sectionTitle, margin: '0 0 6px 0' }}>{t('aivis.title')}</h4>
      <div style={{ fontSize: '14px', color: B.muted, marginBottom: '14px' }}>{t('aivis.hint')}</div>

      {loadError && (
        <div style={{ fontSize: '14px', color: B.error }}>
          {t('aivis.load_error')}: {loadError}
        </div>
      )}

      <div role="tablist" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {AI_TAB_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === active}
            onClick={() => setActive(key)}
            style={{
              ...ghostButton,
              padding: '6px 12px',
              borderColor: key === active ? B.primary : B.border,
              color: key === active ? B.primary : B.muted,
            }}
          >
            {AI_TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {data && (
        <TabBody
          // Remount per tab so the local drafts never leak between tabs.
          key={active}
          analysisId={analysisId}
          tab={active}
          sites={data.sites}
          stored={data.tabs[active] ?? null}
          defaultPrompt={data.defaults[active]}
          onSaved={load}
        />
      )}
    </div>
  )
}

function TabBody({
  analysisId,
  tab,
  sites,
  stored,
  defaultPrompt,
  onSaved,
}: {
  analysisId: string
  tab: AiTabKey
  sites: SiteLite[]
  stored: StoredTab | null
  defaultPrompt: string
  onSaved: () => Promise<void>
}) {
  const { t } = useLocale()
  const [prompt, setPrompt] = useState(stored?.prompt ?? defaultPrompt)
  const [answer, setAnswer] = useState(stored?.answer ?? '')
  const [busy, setBusy] = useState<'save' | 'read' | null>(null)
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isCustom = prompt.trim() !== defaultPrompt.trim()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable: the text stays selectable in the box */
    }
  }

  const onFile = async (file: File | null) => {
    if (!file) return
    try {
      setAnswer(await file.text())
    } catch {
      setError('lettura del file non riuscita')
    }
  }

  const send = async (extract: boolean) => {
    setBusy(extract ? 'read' : 'save')
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/ai-visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab, prompt: isCustom ? prompt : null, answer, extract }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `errore ${res.status}`)
        return
      }
      if (body.extractionError) setError(`${t('aivis.extract_error')}: ${body.extractionError}`)
      else setNote(t('aivis.saved'))
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errore di rete')
    } finally {
      setBusy(null)
    }
  }

  const answerChanged = answer !== (stored?.answer ?? '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
          <strong style={{ fontSize: '14px' }}>{t('aivis.prompt')}</strong>
          {isCustom && <span style={pill(B.warning)}>{t('aivis.prompt_custom')}</span>}
        </div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={9} style={textarea} />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void copy()} style={primaryButton(true)}>
            {copied ? t('aivis.prompt_copied') : t('aivis.prompt_copy')}
          </button>
          {isCustom && (
            <button type="button" onClick={() => setPrompt(defaultPrompt)} style={ghostButton}>
              {t('aivis.prompt_reset')}
            </button>
          )}
        </div>
      </div>

      <div>
        <strong style={{ fontSize: '14px', display: 'block', marginBottom: '6px' }}>{t('aivis.answer')}</strong>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder={t('aivis.answer_placeholder')}
          rows={8}
          style={textarea}
        />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ ...ghostButton, cursor: 'pointer' }}>
            {t('aivis.upload')}
            <input
              type="file"
              accept=".txt,.md,.csv,text/plain,text/csv,text/markdown"
              style={{ display: 'none' }}
              onChange={(e) => {
                void onFile(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </label>
          <button type="button" disabled={busy !== null} onClick={() => void send(false)} style={ghostButton}>
            {t('aivis.save')}
          </button>
          <button
            type="button"
            disabled={busy !== null || !answer.trim()}
            onClick={() => void send(true)}
            style={primaryButton(busy === null && !!answer.trim())}
          >
            {busy === 'read' ? t('aivis.reading') : t('aivis.read')}
          </button>
          {note && <span style={{ fontSize: '14px', color: B.success }}>{note}</span>}
        </div>
        {error && <div style={{ marginTop: '8px', fontSize: '14px', color: B.error }}>{error}</div>}
      </div>

      <Reading tab={tab} sites={sites} stored={stored} answerChanged={answerChanged} />
    </div>
  )
}

function Missing() {
  const { t } = useLocale()
  return <span style={{ color: B.warning, fontWeight: 600 }}>{t('aivis.missing')}</span>
}

const pctText = (v: number | null) => (v === null ? null : `${Math.round(v * 10) / 10}%`)

function Reading({
  tab,
  sites,
  stored,
  answerChanged,
}: {
  tab: AiTabKey
  sites: SiteLite[]
  stored: StoredTab | null
  answerChanged: boolean
}) {
  const { t } = useLocale()
  const ex = stored?.extraction ?? null

  if (!ex) {
    return (
      <div style={{ fontSize: '14px', color: B.muted }}>
        {stored?.extraction_error
          ? `${t('aivis.extract_error')}: ${stored.extraction_error}`
          : stored?.answer.trim()
            ? t('aivis.stale')
            : t('aivis.empty')}
      </div>
    )
  }

  const nameOf = (ref: string) => sites.find((s) => s.site_ref === ref)?.name ?? ref
  const rows = ex.sites as Array<SentimentSite & CitationSite & MarketShareSite>

  return (
    <div>
      {answerChanged && <div style={{ fontSize: '14px', color: B.warning, marginBottom: '8px' }}>{t('aivis.stale')}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ ...cell, borderTop: 'none', textAlign: 'left', color: B.muted }}>{t('aivis.player')}</th>
              {tab === 'sentiment' && (
                <>
                  <th style={{ ...cell, borderTop: 'none', textAlign: 'left' }}>{t('aivis.positive')}</th>
                  <th style={{ ...cell, borderTop: 'none', textAlign: 'left' }}>{t('aivis.neutral')}</th>
                  <th style={{ ...cell, borderTop: 'none', textAlign: 'left' }}>{t('aivis.negative')}</th>
                  <th style={{ ...cell, borderTop: 'none', textAlign: 'left' }}>{t('aivis.themes')}</th>
                </>
              )}
              {tab === 'citations' && (
                <>
                  <th style={{ ...cell, borderTop: 'none', textAlign: 'left' }}>{t('aivis.citation_rate')}</th>
                  <th style={{ ...cell, borderTop: 'none', textAlign: 'left' }}>{t('aivis.sources')}</th>
                </>
              )}
              {tab === 'market_share' && (
                <th style={{ ...cell, borderTop: 'none', textAlign: 'left' }}>{t('aivis.share')}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.site_ref}>
                <td style={{ ...cell, fontWeight: 600 }}>{nameOf(r.site_ref)}</td>
                {tab === 'sentiment' && (
                  <>
                    <td style={cell}>{pctText(r.positive_pct) ?? <Missing />}</td>
                    <td style={cell}>{pctText(r.neutral_pct) ?? <Missing />}</td>
                    <td style={cell}>{pctText(r.negative_pct) ?? <Missing />}</td>
                    <td style={cell}>{r.themes?.length ? r.themes.join(' · ') : <Missing />}</td>
                  </>
                )}
                {tab === 'citations' && (
                  <>
                    <td style={cell}>{pctText(r.citation_rate_pct) ?? <Missing />}</td>
                    <td style={cell}>
                      {r.sources?.length ? (
                        r.sources.map((s) => (
                          <div key={s.domain}>
                            {s.domain}
                            {s.count !== null ? ` (${s.count})` : ''}
                          </div>
                        ))
                      ) : (
                        <span style={{ color: B.warning, fontWeight: 600 }}>{t('aivis.no_sources')}</span>
                      )}
                    </td>
                  </>
                )}
                {tab === 'market_share' && <td style={cell}>{pctText(r.share_pct) ?? <Missing />}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ex.warnings.length > 0 && (
        <div style={{ marginTop: '10px', fontSize: '14px', color: B.warning }}>
          <strong>{t('aivis.warnings')}:</strong>
          {ex.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
      {ex.summary && (
        <div style={{ marginTop: '10px', fontSize: '14px', color: B.ink }}>
          <strong>{t('aivis.summary')}:</strong> {ex.summary}
        </div>
      )}
    </div>
  )
}
