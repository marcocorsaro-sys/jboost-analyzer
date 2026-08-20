'use client'

/**
 * SpendLimitBanner — renders nothing while well under the daily LLM spend
 * cap, a warning when ≥ 80% used, and a hard block notice when at/above the
 * limit. Polls /api/spend-status on mount and every 60s; refetches sooner
 * after a 402 from any in-flight LLM call by listening to a custom event.
 */

import { useEffect, useState } from 'react'
import { B } from '@/lib/brand'

interface SpendStatus {
  spentTodayEur: number
  limitEur: number
  remainingEur: number
  ratio: number
  blocked: boolean
  nearLimit: boolean
}

function formatEur(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

export default function SpendLimitBanner() {
  const [status, setStatus] = useState<SpendStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/spend-status', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setStatus(data.status ?? null)
      } catch {
        /* swallow — banner is best-effort */
      }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 60_000)
    const onSpendEvent = () => fetchStatus()
    window.addEventListener('jboost:spend-limit-hit', onSpendEvent)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('jboost:spend-limit-hit', onSpendEvent)
    }
  }, [])

  if (!status || (!status.nearLimit && !status.blocked)) return null

  const palette = status.blocked
    ? { bg: 'rgba(239, 68, 68, 0.10)', border: B.error, dot: B.error, text: B.error }
    : { bg: 'rgba(245, 158, 11, 0.10)', border: B.warning, dot: B.warning, text: B.warning }
  const pct = Math.min(100, Math.round(status.ratio * 100))

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      padding: '12px 18px',
      background: palette.bg,
      borderBottom: `1px solid ${palette.border}40`,
      fontFamily: B.fontMono,
      fontSize: '12px',
      flexWrap: 'wrap',
    }}>
      <span style={{
        display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
        background: palette.dot, flexShrink: 0,
      }} />
      <strong style={{ color: palette.dot, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
        {status.blocked ? 'Limite spesa LLM raggiunto' : `Avviso spesa LLM — ${pct}% del limite giornaliero`}
      </strong>
      <span style={{ color: palette.text }}>
        {formatEur(status.spentTodayEur)} / {formatEur(status.limitEur)} oggi
        {!status.blocked && ` · rimangono ${formatEur(status.remainingEur)}`}
      </span>
      <span style={{ flex: 1 }} />
      <a
        href={`mailto:?subject=${encodeURIComponent('Aumenta limite spesa LLM JBoost')}&body=${encodeURIComponent(
          `Limite spesa LLM giornaliero (€${status.limitEur.toFixed(2)}) ${status.blocked ? 'raggiunto' : `quasi raggiunto (${pct}%)`} su JBoost Analyzer.\n\nChiedo di aumentare il limite per oggi.`,
        )}`}
        style={{
          padding: '6px 14px',
          background: palette.border,
          color: B.bg,
          borderRadius: '6px',
          textDecoration: 'none',
          fontWeight: 700,
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        Richiedi aumento limite
      </a>
    </div>
  )
}
