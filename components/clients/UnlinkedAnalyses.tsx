'use client'

/**
 * Sprint 1 item 4c — analyses run on the client's SAME DOMAIN but never
 * linked to it (client_id null). The client panel lists them as
 * "da associare" with a one-click Associa action: PATCH
 * /api/v4/analyses/[id] with { client_id } (conditional claim server-side,
 * so a row already linked elsewhere refuses loudly). On success the row is
 * removed locally and the page refreshed so the counts update.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLocale, formatLocalDate } from '@/lib/i18n'
import { B } from '@/lib/brand'

export interface UnlinkedAnalysis {
  id: string
  domain: string | null
  status: string
  created_at: string
  /** V4 discriminator: non-null means /results/v4/[id]. */
  ref_date?: string | null
}

export default function UnlinkedAnalyses({
  clientId,
  analyses,
}: {
  clientId: string
  analyses: UnlinkedAnalysis[]
}) {
  const { t, locale } = useLocale()
  const router = useRouter()
  const [rows, setRows] = useState(analyses)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (rows.length === 0) return null

  const associate = async (analysisId: string) => {
    setBusy(analysisId)
    setError(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `errore ${res.status}`)
        return
      }
      setRows((prev) => prev.filter((r) => r.id !== analysisId))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errore di rete')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      style={{
        marginBottom: '24px',
        padding: '16px 20px',
        background: `${B.warning}08`,
        border: `1px dashed ${B.warning}55`,
        borderRadius: '12px',
      }}
    >
      <div
        style={{
          fontFamily: B.fontMono,
          fontSize: '14px',
          fontWeight: 700,
          color: B.warning,
          marginBottom: '10px',
        }}
      >
        {t('clients.unlinkedTitle')} · {rows.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {rows.map((a) => (
          <div
            key={a.id}
            style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}
          >
            <Link
              href={a.ref_date ? `/results/v4/${a.id}` : `/results/${a.id}`}
              style={{ fontSize: '14px', color: B.ink, textDecoration: 'none', fontWeight: 600 }}
            >
              {a.domain ?? a.id}
            </Link>
            <span style={{ fontSize: '13px', color: B.muted }}>
              {formatLocalDate(a.created_at, locale, { day: '2-digit', month: 'short', year: 'numeric' })}
              {' · '}
              {a.status}
            </span>
            <button
              type="button"
              disabled={busy === a.id}
              onClick={() => void associate(a.id)}
              style={{
                padding: '6px 14px',
                background: busy === a.id ? B.surface2 : B.primary,
                color: busy === a.id ? B.muted : B.bg,
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: busy === a.id ? 'default' : 'pointer',
                fontFamily: B.fontMono,
              }}
            >
              {busy === a.id ? t('clients.associating') : t('clients.associate')}
            </button>
          </div>
        ))}
      </div>
      {error && (
        <div style={{ marginTop: '8px', fontSize: '13px', color: B.error }}>{error}</div>
      )}
    </div>
  )
}
