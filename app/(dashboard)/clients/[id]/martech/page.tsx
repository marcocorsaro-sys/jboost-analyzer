'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import MartechGrid from '@/components/clients/MartechGrid'
import { MARTECH_CATEGORIES, AREA_LABELS } from '@/lib/martech/categories'

interface MartechTool {
  id: string
  category: string
  tool_name: string
  tool_version: string | null
  confidence: number
  details: Record<string, unknown> | null
  detected_at: string
}

export default function ClientMartechPage() {
  const params = useParams()
  const clientId = params.id as string

  const [tools, setTools] = useState<MartechTool[]>([])
  const [domain, setDomain] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMartech()
  }, [clientId])

  async function fetchMartech() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/martech`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fetch failed')
      setTools(data.martech || [])
      setDomain(data.domain || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nel caricamento')
    }
    setLoading(false)
  }

  async function runDetection() {
    setDetecting(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/martech`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Detection failed')
      setTools(data.martech || [])
      setDomain(data.domain || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nella detection')
    }
    setDetecting(false)
  }

  const lastDetected = tools.length > 0
    ? new Date(Math.max(...tools.map(t => new Date(t.detected_at).getTime())))
    : null

  // Count categories with tools
  const uniqueCategories = new Set(tools.map(t => t.category))
  const uniqueAreas = new Set(
    MARTECH_CATEGORIES
      .filter(c => uniqueCategories.has(c.key))
      .map(c => c.area)
  )

  // Average confidence
  const avgConfidence = tools.length > 0
    ? tools.reduce((sum, t) => sum + t.confidence, 0) / tools.length
    : 0

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h3 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 700,
            color: '#ffffff',
            marginBottom: '4px',
          }}>
            Technology Stack Audit
          </h3>
          <p style={{ fontSize: '13px', color: '#6b7280' }}>
            {tools.length > 0
              ? <>
                  <span style={{ color: '#c8e64a', fontWeight: 600 }}>{tools.length}</span> tecnologie rilevate
                  {' · '}
                  <span>{uniqueCategories.size} categorie</span>
                  {' · '}
                  <span>{uniqueAreas.size} aree strategiche</span>
                  {' · '}
                  <span>confidence media {Math.round(avgConfidence * 100)}%</span>
                  {domain && <span style={{ color: '#4b5563' }}>{' · '}{domain}</span>}
                </>
              : domain
                ? `Analizza lo stack tecnologico di ${domain}`
                : 'Configura un dominio per il cliente prima di analizzare'
            }
            {lastDetected && (
              <span style={{ display: 'block', marginTop: '2px', color: '#4b5563', fontSize: '11px' }}>
                Ultimo scan: {lastDetected.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}
                {' alle '}
                {lastDetected.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={runDetection}
          disabled={detecting || !domain}
          style={{
            padding: '8px 16px',
            background: detecting || !domain ? '#2a2d35' : '#c8e64a',
            color: detecting || !domain ? '#6b7280' : '#111318',
            borderRadius: '8px',
            border: 'none',
            fontSize: '13px',
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: detecting || !domain ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
          }}
        >
          {detecting ? 'Analizzando...' : tools.length > 0 ? 'Ri-analizza Stack' : 'Rileva Stack'}
        </button>
      </div>

      {/* Detecting spinner */}
      {detecting && (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '40px',
          textAlign: 'center',
          marginBottom: '20px',
        }}>
          <div style={{
            fontSize: '14px',
            color: '#c8e64a',
            fontFamily: "'JetBrains Mono', monospace",
            marginBottom: '8px',
          }}>
            Enterprise Technology Audit in corso...
          </div>
          <p style={{ fontSize: '12px', color: '#6b7280', maxWidth: '500px', margin: '0 auto' }}>
            Fetch HTML + Headers
            {' → '}Estrazione segnali (scripts, meta, JSON-LD, preconnect, noscript pixels)
            {' → '}Classificazione AI su 30 categorie
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: '8px',
          color: '#ef4444',
          fontSize: '13px',
          marginBottom: '20px',
        }}>
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: '60px 0' }}>
          Caricamento...
        </div>
      ) : tools.length === 0 && !detecting ? (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '40px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚡</div>
          <h4 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 600,
            color: '#c8e64a',
            marginBottom: '8px',
          }}>
            Nessuna Tecnologia Rilevata
          </h4>
          <p style={{ fontSize: '13px', color: '#6b7280', maxWidth: '500px', margin: '0 auto 16px' }}>
            {domain
              ? 'Clicca "Rileva Stack" per un audit completo delle tecnologie utilizzate. L\'analisi copre 30 categorie su 6 aree strategiche: Platform, Data & Intelligence, Acquisition, Experience, Infrastructure e Governance.'
              : 'Configura un dominio per questo cliente nella pagina Overview, poi torna qui per un audit completo dello stack tecnologico.'}
          </p>
        </div>
      ) : (
        <MartechGrid tools={tools} />
      )}
    </div>
  )
}
