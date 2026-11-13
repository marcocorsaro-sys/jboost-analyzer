'use client'

/**
 * V4 — Content tab: upload of the content crawl (CSV UTF-8 / XLSX).
 *
 * The file is validated at upload (lib/v4/content-crawl.ts): the box shows
 * what was understood — rows per player and template, anomalies (sample
 * size, missing columns, metrics without provenance) and the content length
 * stats that will help set the per-page character limit. It is an input
 * upload: it scores nothing and needs no re-measure.
 */

import { useState } from 'react'
import { useLocale } from '@/lib/i18n'
import { B } from '@/lib/brand'
import { fill, mutedLabel } from './results-shared'
import type { DriverRow } from './RunProgress'
import type { SiteMeta } from './results-shared'

export default function ContentCrawlUpload({
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const attachment = (row.attachments ?? []).find((a) => a.kind === 'content_crawl') ?? null
  const crawl = attachment?.parsed?.crawl ?? null
  const nameOf = (ref: string | null, fallback: string) =>
    (ref ? sites.find((s) => s.site_ref === ref)?.name : undefined) ?? (fallback || '?')

  const upload = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('kind', 'content_crawl')
      form.set('file', file)
      const res = await fetch(`/api/v4/analyses/${analysisId}/files`, { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `errore ${res.status}`)
        return
      }
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errore di rete')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        padding: '18px',
        background: B.surface,
        border: `1px dashed ${B.border}`,
        borderRadius: B.radius.control,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div style={{ fontSize: '15px', fontWeight: 650, color: B.ink }}>{t('crawl.title')}</div>
      <div style={{ fontSize: '14px', color: B.muted, lineHeight: 1.5, maxWidth: '75ch' }}>{t('crawl.hint')}</div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          style={{
            padding: '10px 16px',
            background: B.bg,
            border: `1px solid ${B.border}`,
            borderRadius: B.radius.control,
            fontSize: '14px',
            fontWeight: 600,
            color: B.primary,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? t('crawl.uploading') : attachment ? t('crawl.replace') : t('crawl.upload')}
          <input
            type="file"
            accept=".csv,.xlsx"
            disabled={busy}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
              e.target.value = ''
            }}
          />
        </label>
        {attachment && (
          <span style={{ fontSize: '14px', color: B.ink }}>
            {attachment.name}
            {typeof attachment.parsed?.row_count === 'number' && (
              <span style={{ color: B.muted }}> · {attachment.parsed.row_count} {t('crawl.rows')}</span>
            )}
          </span>
        )}
        {!attachment && <span style={{ fontSize: '14px', color: B.muted }}>{t('crawl.none')}</span>}
      </div>

      {error && <div style={{ fontSize: '14px', color: B.error }}>{error}</div>}

      {crawl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
          <div>
            <div style={{ ...mutedLabel, marginBottom: '6px' }}>{t('crawl.groups')}</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {crawl.groups.map((g) => (
                <span
                  key={`${g.site_ref ?? g.player}|${g.template}`}
                  style={{
                    fontSize: '13px',
                    padding: '4px 10px',
                    background: B.bg,
                    border: `1px solid ${B.border}`,
                    borderRadius: B.radius.pill,
                    color: B.ink,
                  }}
                >
                  {nameOf(g.site_ref, g.player)} · {g.template} · {g.rows}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div style={{ ...mutedLabel, marginBottom: '6px' }}>{t('crawl.warnings')}</div>
            {crawl.warnings.length === 0 ? (
              <div style={{ fontSize: '14px', color: B.success }}>{t('crawl.no_warnings')}</div>
            ) : (
              crawl.warnings.map((w) => (
                <div key={w} style={{ fontSize: '14px', color: B.warning, lineHeight: 1.6 }}>
                  {w}
                </div>
              ))
            )}
          </div>

          <div>
            <div style={{ ...mutedLabel, marginBottom: '6px' }}>{t('crawl.chars')}</div>
            <div style={{ fontSize: '14px', color: B.ink }}>
              {fill(t('crawl.chars_value'), { max: crawl.content_chars.max, avg: crawl.content_chars.avg })}
            </div>
            {crawl.char_limit === null && (
              <div style={{ fontSize: '13px', color: B.muted, marginTop: '4px' }}>{t('crawl.limit_pending')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
