'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { getScoreBand } from '@/lib/constants'
import { B } from '@/lib/brand'

export interface AnalysisRow {
  id: string
  domain: string | null
  country: string | null
  language: string | null
  status: string
  overall_score: number | null
  created_at: string
  completed_at: string | null
  competitors: string[] | null
  client_id: string | null
}

export interface ClientInfo {
  id: string
  name: string
}

interface Props {
  analyses: AnalysisRow[]
  clients: ClientInfo[]
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return B.primary
    case 'running': return B.warning
    case 'failed': return B.error
    default: return B.muted
  }
}

export default function ResultsList({ analyses, clients }: Props) {
  const [filter, setFilter] = useState<'all' | 'completed' | 'running' | 'failed'>('all')
  const [clientFilter, setClientFilter] = useState<string>('all')

  const clientMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of clients) m[c.id] = c.name
    return m
  }, [clients])

  const filtered = useMemo(
    () => analyses.filter(a => {
      if (filter !== 'all' && a.status !== filter) return false
      if (clientFilter !== 'all') {
        if (clientFilter === 'none' && a.client_id !== null) return false
        if (clientFilter !== 'none' && a.client_id !== clientFilter) return false
      }
      return true
    }),
    [analyses, filter, clientFilter],
  )

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontFamily: B.fontMono, fontSize: '24px', fontWeight: 700, color: B.ink }}>
          Risultati
        </h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {clients.length > 0 && (
            <select
              value={clientFilter}
              onChange={e => setClientFilter(e.target.value)}
              style={{
                padding: '6px 12px', borderRadius: '6px', border: 'none', fontSize: '12px',
                background: B.surface2, color: B.muted, cursor: 'pointer',
              }}
            >
              <option value="all">Tutti i clienti</option>
              <option value="none">Senza cliente</option>
              {clients.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          )}
          {(['all', 'completed', 'running', 'failed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 14px', borderRadius: '6px', border: 'none', fontSize: '13px',
                fontWeight: 500, cursor: 'pointer',
                background: filter === f ? B.primary : B.surface2,
                color: filter === f ? B.bg : B.muted,
                transition: 'all 0.2s',
              }}
            >
              {f === 'all' ? 'Tutti' : f === 'completed' ? 'Completate' : f === 'running' ? 'In corso' : 'Fallite'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <p style={{ color: B.muted, fontSize: '16px', marginBottom: '16px' }}>
            {filter === 'all' && clientFilter === 'all' ? 'Nessuna analisi.' : 'Nessuna analisi con i filtri attuali.'}
          </p>
          <Link
            href="/analyzer"
            style={{
              display: 'inline-block', padding: '10px 24px',
              background: B.primary, color: B.bg, borderRadius: '8px',
              fontWeight: 600, textDecoration: 'none', fontSize: '14px',
            }}
          >
            Lancia prima analisi
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map(analysis => {
            const band = analysis.overall_score !== null ? getScoreBand(analysis.overall_score) : null
            const bandHex = band?.color === 'green' ? B.success
              : band?.color === 'teal' ? B.teal
              : band?.color === 'amber' ? B.warning
              : B.error
            const clientName = analysis.client_id ? clientMap[analysis.client_id] : null
            return (
              <Link key={analysis.id} href={`/results/${analysis.id}`} style={{ textDecoration: 'none' }}>
                <div
                  style={{
                    background: B.surface, borderRadius: '12px', padding: '20px 24px',
                    border: `1px solid ${B.border}`, display: 'flex', alignItems: 'center',
                    gap: '20px', cursor: 'pointer', transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${B.primary}40`)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = B.border)}
                >
                  <div style={{
                    width: '60px', height: '60px', borderRadius: '12px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: B.fontMono, fontSize: '20px', fontWeight: 700, flexShrink: 0,
                    background: analysis.overall_score !== null ? `${bandHex}15` : B.surface2,
                    color: analysis.overall_score !== null ? bandHex : B.muted,
                  }}>
                    {analysis.overall_score ?? '—'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                      <span style={{
                        fontFamily: B.fontMono,
                        fontSize: '16px', fontWeight: 600, color: B.ink,
                      }}>
                        {analysis.domain}
                      </span>
                      <span style={{
                        fontSize: '11px', fontWeight: 600, padding: '2px 8px',
                        borderRadius: '4px', textTransform: 'uppercase',
                        background: `${statusColor(analysis.status)}15`,
                        color: statusColor(analysis.status),
                      }}>
                        {analysis.status}
                      </span>
                      {clientName && (
                        <span style={{
                          fontSize: '11px', fontWeight: 600, padding: '2px 8px',
                          borderRadius: '4px', background: B.primarySoft, color: B.primary,
                        }}>
                          {clientName}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: B.muted }}>
                      <span>{analysis.country?.toUpperCase()}</span>
                      <span>{new Date(analysis.created_at).toLocaleDateString('it-IT', {
                        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}</span>
                      {analysis.competitors && analysis.competitors.length > 0 && (
                        <span>{analysis.competitors.length} competitor{analysis.competitors.length > 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ color: B.muted, fontSize: '20px' }}>→</div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
