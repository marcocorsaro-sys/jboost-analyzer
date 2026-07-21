'use client'

/**
 * V4 run progress.
 *
 * Polls /api/v4/analyses/[id]/status. The rule this screen exists to respect:
 * a driver that failed shows as failed, with the reason the source gave —
 * never as a 0, never as an empty card that looks like "not much traffic".
 */

import { useCallback, useEffect, useState } from 'react'
import { getV4Driver } from '@/lib/scoring/registry'

interface SiteScore {
  site_ref: string
  domain: string
  raw: number | null
  score_relative?: number | null
  score_absolute?: number | null
}

interface DriverRow {
  driver_key: string
  status: 'queued' | 'running' | 'done' | 'error' | 'needs_decision'
  enabled: boolean
  raw_value: number | null
  score_absolute: number | null
  score_relative: number | null
  tier_used: string | null
  edited: boolean
  attempts: number
  max_attempts: number
  error: string | null
  sites: SiteScore[]
  decision_request: unknown
}

interface StatusResponse {
  analysisId: string
  refDate: string | null
  progress: {
    total: number
    done: number
    error: number
    needs_decision: number
    pending: number
    complete: boolean
  }
  drivers: DriverRow[]
}

const STATUS_STYLE: Record<DriverRow['status'], { label: string; color: string }> = {
  queued: { label: 'IN CODA', color: '#6b7280' },
  running: { label: 'IN CORSO', color: '#14b8a6' },
  done: { label: 'COMPLETATO', color: '#c8e64a' },
  error: { label: 'ERRORE', color: '#ef4444' },
  needs_decision: { label: 'DECISIONE RICHIESTA', color: '#f59e0b' },
}

export default function RunProgress({ analysisId }: { analysisId: string }) {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/status`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) {
        setLoadError(body.error ?? `errore ${res.status}`)
        return
      }
      setData(body as StatusResponse)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'errore di rete')
    }
  }, [analysisId])

  useEffect(() => {
    load()
  }, [load])

  // Poll only while there is something to wait for.
  useEffect(() => {
    if (!data || data.progress.complete) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [data, load])

  const startPending = async () => {
    if (!data) return
    setStarting(true)
    try {
      await fetch(`/api/v4/analyses/${analysisId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drivers: data.drivers.filter((d) => d.enabled).map((d) => d.driver_key) }),
      })
      await load()
    } finally {
      setStarting(false)
    }
  }

  if (loadError) {
    return (
      <div
        style={{
          padding: '12px 16px',
          background: '#ef444420',
          border: '1px solid #ef4444',
          borderRadius: '8px',
          color: '#ef4444',
          fontSize: '13px',
        }}
      >
        {loadError}
      </div>
    )
  }

  if (!data) {
    return <div style={{ color: '#6b7280', fontSize: '14px' }}>Carico…</div>
  }

  const { progress } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div
        style={{
          background: '#1a1c24',
          border: '1px solid #2a2d35',
          borderRadius: '12px',
          padding: '20px 24px',
          display: 'flex',
          gap: '32px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Stat label="Driver" value={String(progress.total)} />
        <Stat label="Completati" value={String(progress.done)} color="#c8e64a" />
        <Stat label="In corso" value={String(progress.pending)} color="#14b8a6" />
        <Stat label="Errori" value={String(progress.error)} color={progress.error ? '#ef4444' : undefined} />
        <Stat
          label="Decisioni"
          value={String(progress.needs_decision)}
          color={progress.needs_decision ? '#f59e0b' : undefined}
        />
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280' }}>
          REF_DATE {data.refDate ?? '—'}
        </div>
      </div>

      {progress.total === 0 && (
        <div
          style={{
            padding: '16px',
            background: '#1a1c24',
            border: '1px solid #2a2d35',
            borderRadius: '12px',
            color: '#a0a0a0',
            fontSize: '14px',
          }}
        >
          Nessun job creato per questa analisi. È stata creata senza avviarla.
        </div>
      )}

      {progress.pending > 0 && (
        <div style={{ fontSize: '12px', color: '#6b7280' }}>
          Aggiornamento automatico ogni 5 secondi.
        </div>
      )}

      {progress.total > 0 && progress.pending === 0 && !progress.complete && (
        <button
          type="button"
          onClick={startPending}
          disabled={starting}
          style={{
            alignSelf: 'flex-start',
            padding: '10px 20px',
            background: '#c8e64a',
            color: '#111318',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: 'pointer',
          }}
        >
          {starting ? 'Avvio…' : 'Avvia i driver in coda'}
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {data.drivers.map((d) => (
          <DriverCard key={d.driver_key} row={d} />
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          color: '#6b7280',
          fontFamily: "'JetBrains Mono', monospace",
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: color ?? '#ffffff' }}>{value}</div>
    </div>
  )
}

function DriverCard({ row }: { row: DriverRow }) {
  const def = getV4Driver(row.driver_key)
  const s = STATUS_STYLE[row.status]

  return (
    <div
      style={{
        background: '#1a1c24',
        border: `1px solid ${row.status === 'error' ? '#ef444440' : '#2a2d35'}`,
        borderRadius: '12px',
        padding: '18px 22px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '15px', fontWeight: 600, color: '#ffffff' }}>
          {def?.label ?? row.driver_key}
        </span>
        <span
          style={{
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', monospace",
            color: s.color,
            border: `1px solid ${s.color}40`,
            borderRadius: '4px',
            padding: '2px 8px',
          }}
        >
          {s.label}
        </span>
        {row.attempts > 1 && (
          <span style={{ fontSize: '11px', color: '#6b7280' }}>
            tentativo {row.attempts}/{row.max_attempts}
          </span>
        )}
        {row.edited && <span style={{ fontSize: '11px', color: '#f59e0b' }}>modificato a mano</span>}

        <span style={{ marginLeft: 'auto', display: 'flex', gap: '20px' }}>
          {row.status === 'done' && (
            <>
              <Metric label="Relativo" value={fmt(row.score_relative)} />
              {def?.hasAbsoluteView && <Metric label="Assoluto" value={fmt(row.score_absolute)} />}
              <Metric label="Raw" value={fmt(row.raw_value)} />
            </>
          )}
        </span>
      </div>

      {row.status === 'error' && row.error && (
        <div style={{ marginTop: '10px', fontSize: '13px', color: '#ef4444', lineHeight: 1.5 }}>
          {row.error}
        </div>
      )}

      {row.status === 'done' && row.sites.length > 0 && (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {row.sites.map((site) => (
            <div
              key={site.site_ref}
              style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#a0a0a0' }}
            >
              <span style={{ width: '160px' }}>{site.domain}</span>
              <span style={{ width: '90px' }}>raw {fmt(site.raw)}</span>
              <span>indice {fmt(site.score_relative ?? null)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ textAlign: 'right' }}>
      <span
        style={{
          display: 'block',
          fontSize: '10px',
          color: '#6b7280',
          fontFamily: "'JetBrains Mono', monospace",
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff' }}>{value}</span>
    </span>
  )
}

/** null is "non misurato" and must never render as 0. */
function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}
