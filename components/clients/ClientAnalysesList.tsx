'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { getScoreBand } from '@/lib/constants'
import { B } from '@/lib/brand'

interface Analysis {
  id: string
  domain: string | null
  country: string | null
  language: string | null
  status: string
  overall_score: number | null
  created_at: string
  completed_at: string | null
  competitors: string[] | null
  target_topic: string | null
}

interface Props {
  analyses: Analysis[]
  clientId: string
  clientDomain: string | null
}

const BAND_COLORS: Record<string, string> = {
  green: B.success,
  teal: B.teal,
  amber: B.warning,
  red: B.error,
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return B.primary
    case 'running': return B.warning
    case 'failed': return B.error
    default: return B.muted
  }
}

// clientDomain stays in Props for the existing callers, but the CTA now goes
// to the V4 wizard (?client= pre-binds; the wizard reads the domain itself).
export default function ClientAnalysesList({ analyses, clientId }: Props) {
  const [filter, setFilter] = useState<'all' | 'completed' | 'running' | 'failed'>('all')
  const filtered = useMemo(
    () => (filter === 'all' ? analyses : analyses.filter(a => a.status === filter)),
    [analyses, filter],
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h3 style={{
            fontFamily: B.fontMono,
            fontSize: '16px', fontWeight: 700, color: B.ink, marginBottom: '4px',
          }}>
            Storico Analisi
          </h3>
          <p style={{ fontSize: '13px', color: B.muted }}>
            {analyses.length} {analyses.length === 1 ? 'analisi' : 'analisi'} per questo cliente
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '4px', marginRight: '12px' }}>
            {(['all', 'completed', 'running', 'failed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '5px 12px', borderRadius: '6px', border: 'none',
                  fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                  background: filter === f ? B.primary : B.surface2,
                  color: filter === f ? B.bg : B.muted,
                  transition: 'all 0.2s',
                }}
              >
                {f === 'all' ? 'Tutti' : f === 'completed' ? 'Completate' : f === 'running' ? 'In corso' : 'Fallite'}
              </button>
            ))}
          </div>
          <Link
            href={`/analyzer/v4?client=${clientId}`}
            style={{
              padding: '8px 16px', background: B.primary, color: B.bg,
              borderRadius: '8px', fontSize: '13px', fontWeight: 700,
              textDecoration: 'none', fontFamily: B.fontMono,
            }}
          >
            + Nuova Analisi
          </Link>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{
          background: B.surface, borderRadius: '12px', border: `1px solid ${B.border}`,
          padding: '40px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>◎</div>
          <p style={{ color: B.muted, fontSize: '14px', marginBottom: '16px' }}>
            {filter === 'all'
              ? 'Nessuna analisi per questo cliente.'
              : `Nessuna analisi ${filter === 'completed' ? 'completata' : filter === 'running' ? 'in corso' : 'fallita'}.`}
          </p>
          <Link
            href={`/analyzer/v4?client=${clientId}`}
            style={{
              display: 'inline-block', padding: '10px 24px', background: B.primary,
              color: B.bg, borderRadius: '8px', fontWeight: 700,
              textDecoration: 'none', fontSize: '13px',
              fontFamily: B.fontMono,
            }}
          >
            Lancia Prima Analisi
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(analysis => {
            const band = analysis.overall_score !== null ? getScoreBand(analysis.overall_score) : null
            const color = band ? BAND_COLORS[band.color] ?? B.muted : B.muted
            return (
              <Link key={analysis.id} href={`/results/${analysis.id}`} style={{ textDecoration: 'none' }}>
                <div
                  style={{
                    background: B.surface, borderRadius: '12px', padding: '16px 20px',
                    border: `1px solid ${B.border}`, display: 'flex', alignItems: 'center',
                    gap: '16px', cursor: 'pointer', transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = `${B.primary}40`)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = B.border)}
                >
                  <div style={{
                    width: 50, height: 50, borderRadius: '10px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: B.fontMono,
                    fontSize: '18px', fontWeight: 700, flexShrink: 0,
                    background: `${color}15`, color,
                  }}>
                    {analysis.overall_score ?? '—'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <span style={{
                        fontFamily: B.fontMono,
                        fontSize: '14px', fontWeight: 600, color: B.ink,
                      }}>
                        {analysis.domain}
                      </span>
                      <span style={{
                        fontSize: '10px', fontWeight: 600, padding: '2px 8px',
                        borderRadius: '4px', textTransform: 'uppercase',
                        background: `${statusColor(analysis.status)}15`,
                        color: statusColor(analysis.status),
                      }}>
                        {analysis.status}
                      </span>
                      {band && (<span style={{ fontSize: '11px', color }}>{band.label}</span>)}
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: B.muted }}>
                      <span>{analysis.country?.toUpperCase()}</span>
                      <span>
                        {new Date(analysis.created_at).toLocaleDateString('it-IT', {
                          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      {analysis.competitors && analysis.competitors.length > 0 && (
                        <span>{analysis.competitors.length} competitor</span>
                      )}
                      {analysis.target_topic && (<span>Topic: {analysis.target_topic}</span>)}
                    </div>
                  </div>
                  <div style={{ color: B.muted, fontSize: '18px', flexShrink: 0 }}>→</div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
