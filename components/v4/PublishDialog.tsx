'use client'

/**
 * V4 — Save & Publish confirmation dialog with the PREVENTIVE DIFF the
 * Bibbia asks for ("show a diff/preview of what will re-run"):
 *
 * - the drivers that WILL be re-run in batch (computed with the SAME pure
 *   selection the publish route uses — lib/v4/publish — so the preview can
 *   never promise something different from what the server does);
 * - the edits that will be stamped and KEPT (a re-run never overwrites an
 *   edited score/comment: normalize.ts skips `edited` rows);
 * - draft-edited drivers that cannot be re-run right now, with the reason.
 */

import { useMemo, useState } from 'react'
import { useLocale } from '@/lib/i18n'
import { getV4Driver } from '@/lib/scoring/registry'
import { selectRerunDrivers } from '@/lib/v4/publish'
import type { EditsResponse } from './results-shared'
import { card, sectionTitle, mutedLabel, pill, primaryButton, ghostButton } from './results-shared'
import { B } from '@/lib/brand'

interface PublishDialogProps {
  analysisId: string
  editsInfo: EditsResponse
  onClose: () => void
  onPublished: () => void
}

export default function PublishDialog({ analysisId, editsInfo, onClose, onPublished }: PublishDialogProps) {
  const { t } = useLocale()
  const [rerun, setRerun] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const drafts = useMemo(() => editsInfo.edits.filter((e) => !e.published), [editsInfo])

  const selection = useMemo(
    () =>
      selectRerunDrivers(
        editsInfo.runs,
        drafts.map((e) => ({ driver_run_id: e.driver_run_id, field: e.field, published: e.published })),
      ),
    [editsInfo.runs, drafts],
  )

  const label = (key: string) => getV4Driver(key)?.label ?? key

  const publish = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rerun }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `error ${res.status}`)
        setBusy(false)
        return
      }
      const rerunKeys: string[] = body.rerun?.drivers ?? []
      setResult(
        `${body.editsPublished} ${t('v4res.pub_done')}` +
          (rerunKeys.length > 0 ? ` ${t('v4res.pub_rerun_started')} ${rerunKeys.map(label).join(', ')}.` : ''),
      )
      onPublished()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error')
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: B.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: '24px',
      }}
      onClick={onClose}
    >
      <div
        style={{ ...card, width: 'min(680px, 100%)', maxHeight: '85vh', overflowY: 'auto', boxShadow: B.shadow.dialog }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={sectionTitle}>{t('v4res.pub_title')}</h3>
        <div style={{ fontSize: '15px', color: B.muted, lineHeight: 1.6, marginBottom: '16px' }}>
          {t('v4res.pub_intro')}
        </div>

        {drafts.length === 0 ? (
          <div style={{ fontSize: '15px', color: B.muted, marginBottom: '16px' }}>{t('v4res.pub_nothing')}</div>
        ) : (
          <>
            {/* Drivers that will re-run. */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ ...mutedLabel, marginBottom: '8px' }}>{t('v4res.pub_rerun_list')}</div>
              {rerun && selection.rerun.length > 0 ? (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {selection.rerun.map((r) => (
                    <span key={r.driver_key} style={pill(B.teal)}>
                      {label(r.driver_key)}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '15px', color: B.muted }}>{t('v4res.pub_no_rerun')}</div>
              )}
              {rerun && selection.ineligible.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '14px', color: B.warning }}>
                  {t('v4res.pub_ineligible')}:{' '}
                  {selection.ineligible.map((i) => `${label(i.driver_key)} (${i.reason})`).join('; ')}
                </div>
              )}
            </div>

            {/* Edits that stay. */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ ...mutedLabel, marginBottom: '8px' }}>{t('v4res.pub_kept_edits')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {drafts.map((e) => (
                  <div key={e.id} style={{ fontSize: '14px', color: B.muted, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ color: B.ink, fontWeight: 600 }}>
                      {e.driver_key ? label(e.driver_key) : '—'}
                    </span>
                    <span style={{ fontFamily: B.fontMono }}>{e.field}</span>
                    <span style={{ color: B.muted }}>{formatValue(e.old_value)}</span>
                    <span style={{ color: B.muted }}>→</span>
                    <span style={{ color: B.primary }}>{formatValue(e.new_value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <label style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', cursor: 'pointer' }}>
              <input type="checkbox" checked={rerun} onChange={(e) => setRerun(e.target.checked)} />
              <span style={{ fontSize: '15px', color: B.ink }}>{t('v4res.pub_rerun_toggle')}</span>
            </label>
          </>
        )}

        {error && <div style={{ fontSize: '14px', color: B.error, marginBottom: '12px' }}>{error}</div>}
        {result && <div style={{ fontSize: '14px', color: B.primary, marginBottom: '12px' }}>{result}</div>}

        <div style={{ display: 'flex', gap: '12px' }}>
          {!result && (
            <button type="button" onClick={publish} disabled={busy} style={primaryButton(!busy)}>
              {busy ? t('v4res.pub_publishing') : t('v4res.pub_confirm')}
            </button>
          )}
          <button type="button" onClick={onClose} style={ghostButton}>
            {result ? t('v4res.close') : t('v4res.pub_cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 60 ? `${s.slice(0, 60)}…` : s
}
