'use client'

/**
 * V4 — Output Preview tab (UX-UI Bibbia sheet 3 E / Drivers Bibbia sheet 6):
 * the deliverable selector — PPTX / Word / interactive HTML artifact, no PDF
 * by default — plus the history of previous generations (deliverables table)
 * and the "Switch to client" promotion hook, which per spec is ONLY a hook
 * today (ongoing phase not built): rendered disabled with the tooltip.
 *
 * The generators themselves are server-only (lib/v4/export/*): this
 * component only calls GET /api/v4/analyses/[id]/export and hands the file
 * to the browser — nothing heavy ever enters the client bundle.
 */

import { useCallback, useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import { card, sectionTitle, mutedLabel, pill, primaryButton, ghostButton } from './results-shared'
import { B } from '@/lib/brand'

type ExportFormat = 'pptx' | 'docx' | 'artifact'

interface DeliverableRow {
  id: string
  format: string
  file_ref: string | null
  generated_by: string | null
  generated_at: string
}

const FORMAT_CARDS: Array<{ key: ExportFormat; name: string; descKey: TranslationKey }> = [
  { key: 'pptx', name: 'PPTX', descKey: 'v4export.desc_pptx' },
  { key: 'docx', name: 'Word (.docx)', descKey: 'v4export.desc_docx' },
  { key: 'artifact', name: 'Artifact (HTML)', descKey: 'v4export.desc_artifact' },
]

export default function OutputPreviewTab({
  analysisId,
  anyDriverDone,
}: {
  analysisId: string
  anyDriverDone: boolean
}) {
  const { t, locale } = useLocale()
  const [format, setFormat] = useState<ExportFormat>('pptx')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<DeliverableRow[] | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/export?list=1`, { cache: 'no-store' })
      if (res.ok) {
        const body = (await res.json()) as { deliverables: DeliverableRow[] }
        setHistory(body.deliverables)
      }
    } catch {
      /* history is secondary; generation errors are the loud ones */
    }
  }, [analysisId])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const generate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/export?format=${format}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `errore ${res.status}`)
        return
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const fileName =
        res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        `jboost-audit.${format === 'artifact' ? 'html' : format}`
      if (format === 'artifact') {
        // The artifact IS the interactive view: open it, don't bury it in Downloads.
        window.open(objectUrl, '_blank', 'noopener')
      } else {
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      // Revoke later: an immediate revoke races the download/new tab.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
      await loadHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error')
    } finally {
      setGenerating(false)
    }
  }, [analysisId, format, loadHistory])

  const formatDate = (iso: string): string => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString(locale === 'it' ? 'it-IT' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ---------------------------------------------- format selector --- */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h3 style={{ ...sectionTitle, margin: 0 }}>{t('v4export.title')}</h3>
          <span style={{ fontSize: '14px', color: B.muted }}>{t('v4export.no_pdf_note')}</span>
        </div>

        <div
          style={{
            marginTop: '16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '14px',
          }}
        >
          {FORMAT_CARDS.map((f) => {
            const active = format === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFormat(f.key)}
                className="jk-card-hover"
                style={{
                  textAlign: 'left',
                  background: active ? B.primarySoft : B.bg,
                  border: `1px solid ${active ? `${B.primary}55` : B.border}`,
                  borderRadius: B.radius.card,
                  padding: '20px 22px',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    fontSize: '17px',
                    fontWeight: 650,
                    color: active ? B.primary : B.ink,
                  }}
                >
                  {f.name}
                </div>
                <div style={{ fontSize: '14px', color: B.muted, lineHeight: 1.5, marginTop: '8px' }}>
                  {t(f.descKey)}
                </div>
              </button>
            )
          })}
        </div>

        <div style={{ marginTop: '16px', display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={generate}
            disabled={generating || !anyDriverDone}
            style={primaryButton(!generating && anyDriverDone)}
            title={!anyDriverDone ? t('v4export.need_driver') : undefined}
          >
            {generating ? t('v4export.generating') : t('v4export.generate')}
          </button>
          {!anyDriverDone && (
            <span style={{ fontSize: '14px', color: B.warning }}>{t('v4export.need_driver')}</span>
          )}
          {/* Switch to client — spec: promotion hook only, ongoing phase not built. */}
          <button
            type="button"
            disabled
            title={t('v4export.switch_client_tooltip')}
            style={{ ...ghostButton, cursor: 'not-allowed', opacity: 0.5, marginLeft: 'auto' }}
          >
            {t('v4export.switch_client')}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: '12px', fontSize: '14px', color: B.error }}>
            {t('v4export.error')}: {error}
          </div>
        )}
      </div>

      {/* ---------------------------------------------- history ----------- */}
      <div style={card}>
        <h3 style={sectionTitle}>{t('v4export.history')}</h3>
        {history === null ? (
          <div style={{ fontSize: '15px', color: B.muted }}>…</div>
        ) : history.length === 0 ? (
          <div style={{ fontSize: '15px', color: B.muted }}>{t('v4export.history_empty')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {history.map((h) => (
              <div key={h.id} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={pill(B.teal)}>{h.format}</span>
                <span style={{ fontSize: '15px', color: B.ink }}>{h.file_ref ?? '—'}</span>
                <span style={{ ...mutedLabel, textTransform: 'none' }}>{formatDate(h.generated_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
