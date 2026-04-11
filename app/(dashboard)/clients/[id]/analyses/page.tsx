'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getScoreBand } from '@/lib/constants'
import Link from 'next/link'

interface Analysis {
  id: string
  domain: string
  country: string
  language: string
  status: string
  overall_score: number | null
  created_at: string
  completed_at: string | null
  competitors: string[]
  target_topic: string | null
}

const BAND_COLORS: Record<string, string> = {
  green: '#22c55e',
  teal: '#14b8a6',
  amber: '#f59e0b',
  red: '#ef4444',
}

export default function ClientAnalysesPage() {
  const params = useParams()
  const clientId = params.id as string
  const supabase = createClient()

  const [analyses, setAnalyses] = useState<Analysis[]>([])
  const [loading, setLoading] = useState(true)
  const [client, setClient] = useState<{ name: string; domain: string | null } | null>(null)
  const [filter, setFilter] = useState<'all' | 'completed' | 'running' | 'failed'>('all')

  useEffect(() => {
    fetchData()
  }, [clientId])

  async function fetchData() {
    setLoading(true)

    // Fetch client info
    const { data: clientData } = await supabase
      .from('clients')
      .select('name, domain')
      .eq('id', clientId)
      .single()

    if (clientData) setClient(clientData)

    // Fetch analyses for this client
    const { data } = await supabase
      .from('analyses')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    setAnalyses(data ?? [])
    setLoading(false)
  }

  const filtered = filter === 'all'
    ? analyses
    : analyses.filter(a => a.status === filter)

  const statusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#c8e64a'
      case 'running': return '#f59e0b'
      case 'failed': return '#ef4444'
      default: return '#6b7280'
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h3 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 700,
            color: '#ffffff',
            marginBottom: '4px',
          }}>
            Storico Analisi
          </h3>
          <p style={{ fontSize: '13px', color: '#6b7280' }}>
            {analyses.length} {analyses.length === 1 ? 'analisi' : 'analisi'} per questo cliente
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '4px', marginRight: '12px' }}>
            {(['all', 'completed', 'running', 'failed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  background: filter === f ? '#c8e64a' : '#1e2028',
                  color: filter === f ? '#111318' : '#a0a0a0',
                  transition: 'all 0.2s',
                }}
              >
                {f === 'all' ? 'Tutti' : f === 'completed' ? 'Completate' : f === 'running' ? 'In corso' : 'Fallite'}
              </button>
            ))}
          </div>
          <Link
            href={`/analyzer?client=${clientId}&domain=${client?.domain || ''}`}
            style={{
              padding: '8px 16px',
              background: '#c8e64a',
              color: '#111318',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              textDecoration: 'none',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            + Nuova Analisi
          </Link>
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: '60px 0' }}>
          Caricamento analisi...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '40px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>◎</div>
          <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '16px' }}>
            {filter === 'all'
              ? 'Nessuna analisi per questo cliente.'
              : `Nessuna analisi ${filter === 'completed' ? 'completata' : filter === 'running' ? 'in corso' : 'fallita'}.`}
          </p>
          <Link
            href={`/analyzer?client=${clientId}&domain=${client?.domain || ''}`}
            style={{
              display: 'inline-block',
              padding: '10px 24px',
              background: '#c8e64a',
              color: '#111318',
              borderRadius: '8px',
              fontWeight: 700,
              textDecoration: 'none',
              fontSize: '13px',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Lancia Prima Analisi
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(analysis => {
            const band = analysis.overall_score !== null ? getScoreBand(analysis.overall_score) : null
            const color = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'

            return (
              <Link
                key={analysis.id}
                href={`/results/${analysis.id}`}
                style={{ textDecoration: 'none' }}
              >
                <div
                  style={{
                    background: '#1a1c24',
                    borderRadius: '12px',
                    padding: '16px 20px',
                    border: '1px solid #2a2d35',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#c8e64a40')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2d35')}
                >
                  {/* Score badge */}
                  <div style={{
                    width: 50,
                    height: 50,
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '18px',
                    fontWeight: 700,
                    flexShrink: 0,
                    background: `${color}15`,
                    color: color,
                  }}>
                    {analysis.overall_score ?? '—'}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#ffffff',
                      }}>
                        {analysis.domain}
                      </span>
                      <span style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        textTransform: 'uppercase',
                        background: `${statusColor(analysis.status)}15`,
                        color: statusColor(analysis.status),
                      }}>
                        {analysis.status}
                      </span>
                      {band && (
                        <span style={{ fontSize: '11px', color }}>
                          {band.label}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#6b7280' }}>
                      <span>{analysis.country?.toUpperCase()}</span>
                      <span>
                        {new Date(analysis.created_at).toLocaleDateString('it-IT', {
                          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      {analysis.competitors?.length > 0 && (
                        <span>{analysis.competitors.length} competitor</span>
                      )}
                      {analysis.target_topic && (
                        <span>Topic: {analysis.target_topic}</span>
                      )}
                    </div>
                  </div>

                  {/* Arrow */}
                  <div style={{ color: '#6b7280', fontSize: '18px', flexShrink: 0 }}>→</div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
