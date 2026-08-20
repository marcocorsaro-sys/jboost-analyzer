'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import SchemaRadiography, { type SchemaReport } from '@/components/clients/SchemaRadiography'
import { B } from '@/lib/brand'

export default function ClientStructuredDataPage() {
  const params = useParams()
  const clientId = params.id as string

  const [report, setReport] = useState<SchemaReport | null>(null)
  const [domain, setDomain] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/clients/${clientId}/schema`)
      const data = await res.json()
      if (cancelled) return
      if (!res.ok) {
        setError(data.error || 'Errore caricamento')
        setLoading(false)
        return
      }
      setDomain(data.domain ?? null)
      setReport(data.report ?? null)
      setUpdatedAt(data.updatedAt ?? null)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [clientId])

  async function runRadiography() {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Radiografia fallita')
      setReport(data.report)
      setUpdatedAt(new Date().toISOString())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore radiografia')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h3 style={{
            fontFamily: B.fontMono,
            fontSize: '16px',
            fontWeight: 700,
            color: B.ink,
            marginBottom: '4px',
          }}>
            Structured Data — Schema Radiography
          </h3>
          <p style={{ fontSize: '13px', color: B.muted }}>
            {domain
              ? <>Analisi JSON-LD + OpenGraph su <span style={{ color: B.primary }}>{domain}</span> · score per template + proposta di arricchimento con score proiettato.</>
              : <>Configura il dominio del cliente per lanciare la radiografia.</>}
            {updatedAt && (
              <span style={{ display: 'block', marginTop: '2px', fontSize: '11px', color: B.muted }}>
                Ultima radiografia: {new Date(updatedAt).toLocaleString('it-IT', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={runRadiography}
          disabled={running || !domain}
          style={{
            padding: '8px 16px',
            background: running || !domain ? B.border : B.primary,
            color: running || !domain ? B.muted : B.bg,
            borderRadius: '8px',
            border: 'none',
            fontSize: '13px',
            fontWeight: 700,
            fontFamily: B.fontMono,
            cursor: running || !domain ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {running ? 'Radiografia in corso…' : report ? 'Ri-radiografia completa' : 'Lancia radiografia'}
        </button>
      </div>

      {/* Progress strip during a full re-radiography (non-blocking — old data stays visible below) */}
      {running && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          background: B.surface,
          border: `1px solid ${B.primary}40`,
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '20px',
        }}>
          <span
            className="animate-spin"
            style={{
              width: 16, height: 16, borderRadius: '50%',
              border: `2px solid ${B.border}`, borderTopColor: B.primary,
              display: 'inline-block', flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '13px', fontWeight: 600, color: B.primary, fontFamily: B.fontMono }}>
            Crawling ~30 pagine
          </span>
          <span style={{ fontSize: '12px', color: B.muted }}>
            sitemap → scrape Firecrawl → estrazione JSON-LD/OG → scoring → enrichment LLM
          </span>
        </div>
      )}

      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: '8px',
          color: B.error,
          fontSize: '13px',
          marginBottom: '20px',
        }}>{error}</div>
      )}

      {/* Body */}
      {loading ? (
        <div style={{ color: B.muted, textAlign: 'center', padding: '60px 0' }}>Caricamento…</div>
      ) : !report ? (
        <div style={{
          background: B.surface,
          border: `1px solid ${B.border}`,
          borderRadius: '12px',
          padding: '48px 32px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>◇</div>
          <div style={{ fontFamily: B.fontMono, fontSize: '16px', color: B.primary, fontWeight: 600, marginBottom: '8px' }}>
            Nessuna radiografia ancora eseguita
          </div>
          <p style={{ fontSize: '13px', color: B.muted, maxWidth: '480px', margin: '0 auto' }}>
            {domain
              ? <>Premi &laquo;Lancia radiografia&raquo; per crawlare ~30 pagine e generare lo score per ogni template JSON-LD con proposta di arricchimento.</>
              : <>Manca il dominio del cliente. Aggiungilo dalla pagina Overview prima di lanciare la radiografia.</>}
          </p>
        </div>
      ) : (
        <div style={{
          opacity: running ? 0.5 : 1,
          pointerEvents: running ? 'none' : 'auto',
          transition: 'opacity 0.2s',
        }}>
          <SchemaRadiography
            report={report}
            clientId={clientId}
            onTemplateRefreshed={(updated) => {
              setReport(updated)
              setUpdatedAt(new Date().toISOString())
            }}
          />
        </div>
      )}
    </div>
  )
}
