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
import { B } from '@/lib/brand'

export interface SiteScore {
  site_ref: string
  domain: string
  raw: number | null
  score_relative?: number | null
  score_absolute?: number | null
  rank?: number | null
  /** Free-form per-site evidence the worker recorded (tables, counts, criteria). */
  evidence?: Record<string, unknown>
}

export interface DriverRow {
  driver_key: string
  status: 'queued' | 'running' | 'done' | 'error' | 'needs_decision'
  enabled: boolean
  raw_value: number | null
  score_absolute: number | null
  score_relative: number | null
  comment_absolute: string | null
  comment_relative: string | null
  tier_used: string | null
  edited: boolean
  attempts: number
  max_attempts: number
  error: string | null
  sites: SiteScore[]
  decision_request: unknown
  /** Setup uploads bound to this driver (parsing downstream — listed only). */
  attachments?: Array<{ kind: string; name: string; path?: string; size?: number | null }>
}

export interface StatusResponse {
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

export const STATUS_STYLE: Record<DriverRow['status'], { label: string; color: string }> = {
  queued: { label: 'IN CODA', color: B.muted },
  running: { label: 'IN CORSO', color: B.teal },
  done: { label: 'COMPLETATO', color: B.primary },
  error: { label: 'ERRORE', color: B.error },
  needs_decision: { label: 'DECISIONE RICHIESTA', color: B.warning },
}

export default function RunProgress({ analysisId }: { analysisId: string }) {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [drafts, setDrafts] = useState(0)
  const [publishState, setPublishState] = useState<string | null>(null)

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

      // Draft edits live in their own table; the status route is about the
      // measurement, not about what the analyst changed on top of it.
      const editsRes = await fetch(`/api/v4/analyses/${analysisId}/publish`, { cache: 'no-store' })
      if (editsRes.ok) {
        const editsBody = await editsRes.json()
        setDrafts(editsBody.drafts ?? 0)
      }
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

  const publish = async () => {
    setPublishState('Pubblico…')
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/publish`, { method: 'POST' })
      const body = await res.json()
      setPublishState(
        res.ok
          ? `Pubblicate ${body.editsPublished} modifiche.`
          : (body.error ?? 'pubblicazione fallita'),
      )
      await load()
    } catch (err) {
      setPublishState(err instanceof Error ? err.message : 'errore di rete')
    }
  }

  if (loadError) {
    return (
      <div
        style={{
          padding: '12px 16px',
          background: `${B.error}20`,
          border: `1px solid ${B.error}`,
          borderRadius: '8px',
          color: B.error,
          fontSize: '13px',
        }}
      >
        {loadError}
      </div>
    )
  }

  if (!data) {
    return <div style={{ color: B.muted, fontSize: '14px' }}>Carico…</div>
  }

  const { progress } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div
        style={{
          background: B.surface,
          border: `1px solid ${B.border}`,
          borderRadius: '12px',
          padding: '20px 24px',
          display: 'flex',
          gap: '32px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Stat label="Driver" value={String(progress.total)} />
        <Stat label="Completati" value={String(progress.done)} color={B.primary} />
        <Stat label="In corso" value={String(progress.pending)} color={B.teal} />
        <Stat label="Errori" value={String(progress.error)} color={progress.error ? B.error : undefined} />
        <Stat
          label="Decisioni"
          value={String(progress.needs_decision)}
          color={progress.needs_decision ? B.warning : undefined}
        />
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: B.muted }}>
          REF_DATE {data.refDate ?? '—'}
        </div>
      </div>

      {progress.total === 0 && (
        <div
          style={{
            padding: '16px',
            background: B.surface,
            border: `1px solid ${B.border}`,
            borderRadius: '12px',
            color: B.muted,
            fontSize: '14px',
          }}
        >
          Nessun job creato per questa analisi. È stata creata senza avviarla.
        </div>
      )}

      {progress.pending > 0 && (
        <div style={{ fontSize: '12px', color: B.muted }}>
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
            background: B.primary,
            color: B.bg,
            border: 'none',
            borderRadius: '8px',
            fontWeight: 700,
            fontFamily: B.fontMono,
            cursor: 'pointer',
          }}
        >
          {starting ? 'Avvio…' : 'Avvia i driver in coda'}
        </button>
      )}

      {progress.total > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            flexWrap: 'wrap',
            padding: '14px 18px',
            background: B.surface,
            border: `1px solid ${B.border}`,
            borderRadius: '12px',
          }}
        >
          <button
            type="button"
            onClick={publish}
            disabled={progress.pending > 0}
            style={{
              padding: '10px 20px',
              background: progress.pending > 0 ? B.border : B.primary,
              color: progress.pending > 0 ? B.muted : B.bg,
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              fontFamily: B.fontMono,
              fontSize: '13px',
              cursor: progress.pending > 0 ? 'default' : 'pointer',
            }}
          >
            Save &amp; Publish
          </button>
          <span style={{ fontSize: '13px', color: drafts > 0 ? B.warning : B.muted }}>
            {drafts > 0 ? `${drafts} modifiche in bozza` : 'nessuna modifica in bozza'}
          </span>
          {progress.pending > 0 && (
            <span style={{ fontSize: '12px', color: B.muted }}>
              Non pubblicabile finché {progress.pending} driver sono ancora in corso.
            </span>
          )}
          {publishState && <span style={{ fontSize: '12px', color: B.muted }}>{publishState}</span>}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {data.drivers.map((d) => (
          <DriverCard key={d.driver_key} row={d} analysisId={analysisId} onChanged={load} />
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
          color: B.muted,
          fontFamily: B.fontMono,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: color ?? B.ink }}>{value}</div>
    </div>
  )
}

function DriverCard({
  row,
  analysisId,
  onChanged,
}: {
  row: DriverRow
  analysisId: string
  onChanged: () => void
}) {
  const def = getV4Driver(row.driver_key)
  const s = STATUS_STYLE[row.status]
  const [editing, setEditing] = useState(false)

  return (
    <div
      style={{
        background: B.surface,
        border: `1px solid ${row.status === 'error' ? `${B.error}40` : B.border}`,
        borderRadius: '12px',
        padding: '18px 22px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '15px', fontWeight: 600, color: B.ink }}>
          {def?.label ?? row.driver_key}
        </span>
        <span
          style={{
            fontSize: '11px',
            fontFamily: B.fontMono,
            color: s.color,
            border: `1px solid ${s.color}40`,
            borderRadius: '4px',
            padding: '2px 8px',
          }}
        >
          {s.label}
        </span>
        {row.attempts > 1 && (
          <span style={{ fontSize: '11px', color: B.muted }}>
            tentativo {row.attempts}/{row.max_attempts}
          </span>
        )}
        {row.edited && <span style={{ fontSize: '11px', color: B.warning }}>modificato a mano</span>}

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
        <div style={{ marginTop: '10px', fontSize: '13px', color: B.error, lineHeight: 1.5 }}>
          {row.error}
        </div>
      )}

      {row.status === 'done' && (
        <div style={{ marginTop: '10px' }}>
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            style={{
              background: 'transparent',
              border: `1px solid ${B.border}`,
              borderRadius: '6px',
              color: B.muted,
              padding: '4px 12px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            {editing ? 'Chiudi' : 'Modifica punteggio e commento'}
          </button>
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
        </div>
      )}

      {row.status === 'needs_decision' && (
        <DecisionForm row={row} analysisId={analysisId} onAnswered={onChanged} />
      )}

      {(row.comment_relative || row.comment_absolute) && (
        <div style={{ marginTop: '10px', fontSize: '13px', color: B.muted, lineHeight: 1.5 }}>
          {row.comment_relative && <div>Relativo: {row.comment_relative}</div>}
          {row.comment_absolute && <div>Assoluto: {row.comment_absolute}</div>}
        </div>
      )}

      {row.status === 'done' && row.sites.length > 0 && (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {row.sites.map((site) => (
            <div
              key={site.site_ref}
              style={{ display: 'flex', gap: '16px', fontSize: '12px', color: B.muted }}
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
          color: B.muted,
          fontFamily: B.fontMono,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: '16px', fontWeight: 700, color: B.ink }}>{value}</span>
    </span>
  )
}

/** null is "non misurato" and must never render as 0. */
export function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}

/**
 * Inline editor for the analyst's judgement.
 *
 * Only the score and the comment: the raw is what the source reported, and
 * editing it would silently move every other site's leader index. See
 * lib/v4/edits.ts.
 */
export function DriverEditor({
  row,
  analysisId,
  onSaved,
}: {
  row: DriverRow
  analysisId: string
  onSaved: () => void
}) {
  const def = getV4Driver(row.driver_key)
  const [scoreRelative, setScoreRelative] = useState(row.score_relative?.toString() ?? '')
  const [scoreAbsolute, setScoreAbsolute] = useState(row.score_absolute?.toString() ?? '')
  const [commentRelative, setCommentRelative] = useState(row.comment_relative ?? '')
  const [commentAbsolute, setCommentAbsolute] = useState(row.comment_absolute ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    const body: Record<string, unknown> = {
      score_relative: scoreRelative === '' ? null : scoreRelative,
      comment_relative: commentRelative || null,
    }
    if (def?.hasAbsoluteView) {
      body.score_absolute = scoreAbsolute === '' ? null : scoreAbsolute
      body.comment_absolute = commentAbsolute || null
    }

    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/drivers/${row.driver_key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(Array.isArray(data.details) ? data.details.join(' | ') : (data.error ?? 'errore'))
        setSaving(false)
        return
      }
      if (data.warning) setError(data.warning)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errore di rete')
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        marginTop: '12px',
        padding: '16px',
        background: B.bg,
        border: `1px solid ${B.border}`,
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div>
          <label style={editLabel}>Punteggio relativo (0-100)</label>
          <input
            style={editInput}
            value={scoreRelative}
            onChange={(e) => setScoreRelative(e.target.value)}
            placeholder="vuoto = nessun punteggio"
          />
        </div>
        {def?.hasAbsoluteView && (
          <div>
            <label style={editLabel}>Punteggio assoluto (0-100)</label>
            <input
              style={editInput}
              value={scoreAbsolute}
              onChange={(e) => setScoreAbsolute(e.target.value)}
              placeholder="vuoto = nessun punteggio"
            />
          </div>
        )}
      </div>

      <div>
        <label style={editLabel}>Commento (vista relativa)</label>
        <textarea
          style={{ ...editInput, minHeight: '64px', resize: 'vertical' }}
          value={commentRelative}
          onChange={(e) => setCommentRelative(e.target.value)}
        />
      </div>

      {def?.hasAbsoluteView && (
        <div>
          <label style={editLabel}>Commento (vista assoluta)</label>
          <textarea
            style={{ ...editInput, minHeight: '64px', resize: 'vertical' }}
            value={commentAbsolute}
            onChange={(e) => setCommentAbsolute(e.target.value)}
          />
        </div>
      )}

      <div style={{ fontSize: '12px', color: B.muted }}>
        Il raw non è modificabile: è la misura della fonte. Per cambiarlo si rilancia il driver.
        Una modifica salvata resta bozza finché non fai Save &amp; Publish.
      </div>

      {error && <div style={{ fontSize: '12px', color: B.error }}>{error}</div>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 18px',
          background: B.primary,
          color: B.bg,
          border: 'none',
          borderRadius: '6px',
          fontWeight: 700,
          fontSize: '13px',
          cursor: 'pointer',
        }}
      >
        {saving ? 'Salvo…' : 'Salva modifica'}
      </button>
    </div>
  )
}

/**
 * Answer a paused job.
 *
 * Two shapes today: the Discoverability tier cascade and the manual
 * AI Visibility score. Both go through the same decision endpoint, which
 * re-queues the job — nothing is scored here.
 */
export function DecisionForm({
  row,
  analysisId,
  onAnswered,
}: {
  row: DriverRow
  analysisId: string
  onAnswered: () => void
}) {
  const request = (row.decision_request ?? {}) as {
    reason?: string
    message?: string
    empty_players?: string[]
    next_tier?: string | null
  }
  const [score, setScore] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replaceTo, setReplaceTo] = useState('')
  const [replaceBrand, setReplaceBrand] = useState('')

  const send = async (decision: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/v4/analyses/${analysisId}/drivers/${row.driver_key}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
      )
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'errore')
        setBusy(false)
        return
      }
      onAnswered()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errore di rete')
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        marginTop: '12px',
        padding: '16px',
        background: `${B.warning}10`,
        border: `1px solid ${B.warning}40`,
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {request.message && (
        <div style={{ fontSize: '13px', color: B.warning, lineHeight: 1.5 }}>{request.message}</div>
      )}

      {request.reason === 'empty_tier' && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {request.next_tier && (
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ tier: request.next_tier })}
              style={decisionButton}
            >
              Estendi al tier {request.next_tier} (tutto il set)
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => send({ removed: request.empty_players ?? [] })}
            style={decisionButton}
          >
            Rimuovi {(request.empty_players ?? []).join(', ')} dal set
          </button>
        </div>
      )}

      {request.reason === 'empty_tier' && (request.empty_players ?? []).length > 0 && (
        // Replace (Bibbia): swap the empty competitor with another domain.
        // The whole audit re-runs from scratch — replacing a player changes
        // the SET every driver measured, so the route resets everything.
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            style={{ ...editInput, minWidth: '200px' }}
            value={replaceTo}
            onChange={(e) => setReplaceTo(e.target.value)}
            placeholder={`Nuovo dominio al posto di ${(request.empty_players ?? [])[0]}`}
          />
          <input
            style={{ ...editInput, minWidth: '140px' }}
            value={replaceBrand}
            onChange={(e) => setReplaceBrand(e.target.value)}
            placeholder="Brand name (opz.)"
          />
          <button
            type="button"
            disabled={busy || !replaceTo.trim()}
            onClick={() =>
              send({
                replace: {
                  from: (request.empty_players ?? [])[0],
                  to: replaceTo.trim(),
                  ...(replaceBrand.trim() ? { brand_name: replaceBrand.trim() } : {}),
                },
              })
            }
            style={decisionButton}
          >
            Sostituisci (ri-esegue tutta l&apos;analisi)
          </button>
        </div>
      )}

      {request.reason === 'manual_input' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '12px' }}>
            <input
              style={editInput}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="Punteggio 0-100"
            />
            <input
              style={editInput}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Commento (opzionale)"
            />
          </div>
          <button
            type="button"
            disabled={busy || score === ''}
            onClick={() => send({ score: Number(score), comment: comment || null })}
            style={decisionButton}
          >
            {busy ? 'Invio…' : 'Salva punteggio J-Horizon'}
          </button>
        </>
      )}

      {error && <div style={{ fontSize: '12px', color: B.error }}>{error}</div>}
    </div>
  )
}

export const editLabel: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: B.muted,
  marginBottom: '5px',
  fontFamily: B.fontMono,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

export const editInput: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: B.surface2,
  border: `1px solid ${B.border}`,
  borderRadius: '6px',
  color: B.ink,
  fontSize: '13px',
  outline: 'none',
  fontFamily: 'inherit',
}

const decisionButton: React.CSSProperties = {
  padding: '8px 16px',
  background: B.warning,
  color: B.bg,
  border: 'none',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 700,
  cursor: 'pointer',
}
