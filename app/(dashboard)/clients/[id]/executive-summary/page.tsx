'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useCompletion } from 'ai/react'
import MarkdownRenderer from '@/components/shared/MarkdownRenderer'

interface PersistedSummary {
  id: string
  content: string
  model: string
  generated_at: string
  analysis_id: string | null
}

export default function ClientExecutiveSummaryPage() {
  const params = useParams()
  const clientId = params.id as string

  const [persisted, setPersisted] = useState<PersistedSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const {
    completion,
    complete,
    isLoading: isGenerating,
  } = useCompletion({
    api: `/api/clients/${clientId}/executive-summary`,
  })

  const loadSummary = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/executive-summary`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel caricamento')
      setPersisted(data.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nel caricamento')
    }
    setLoading(false)
  }, [clientId])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  async function handleGenerate() {
    setError(null)
    try {
      await complete('')
      // After streaming completes, reload persisted summary for metadata
      setTimeout(() => loadSummary(), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nella generazione')
    }
  }

  // Show streaming content during generation, otherwise persisted
  const displayContent = isGenerating && completion
    ? completion
    : persisted?.content || null

  const hasNoAnalysis = error?.includes('Nessuna analisi completata')

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '20px',
      }}>
        <div>
          <h3 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 700,
            color: '#ffffff',
            marginBottom: '4px',
          }}>
            Executive Summary
          </h3>
          <p style={{ fontSize: '13px', color: '#6b7280' }}>
            {persisted
              ? <>
                  Generato il{' '}
                  <span style={{ color: '#c8e64a' }}>
                    {new Date(persisted.generated_at).toLocaleDateString('it-IT', {
                      day: '2-digit', month: 'long', year: 'numeric',
                    })}
                  </span>
                  {' alle '}
                  {new Date(persisted.generated_at).toLocaleTimeString('it-IT', {
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {' — '}
                  <span style={{ color: '#4b5563' }}>{persisted.model}</span>
                </>
              : 'Genera un Executive Summary basato sull\'ultima analisi del cliente'
            }
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating || hasNoAnalysis}
          style={{
            padding: '8px 16px',
            background: isGenerating || hasNoAnalysis ? '#2a2d35' : '#c8e64a',
            color: isGenerating || hasNoAnalysis ? '#6b7280' : '#111318',
            borderRadius: '8px',
            border: 'none',
            fontSize: '13px',
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: isGenerating || hasNoAnalysis ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
          }}
        >
          {isGenerating
            ? 'Generando...'
            : persisted
              ? 'Rigenera Summary'
              : 'Genera Executive Summary'
          }
        </button>
      </div>

      {/* Generating indicator */}
      {isGenerating && !completion && (
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
            Generazione Executive Summary in corso...
          </div>
          <p style={{ fontSize: '12px', color: '#6b7280', maxWidth: '500px', margin: '0 auto' }}>
            Analisi di tutti i driver, benchmark competitivo, stack tecnologico e raccomandazioni prioritarie
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
      {loading && !isGenerating ? (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: '60px 0' }}>
          Caricamento...
        </div>
      ) : displayContent ? (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '28px 32px',
        }}>
          <MarkdownRenderer content={displayContent} />
        </div>
      ) : !isGenerating && !hasNoAnalysis ? (
        /* Empty state */
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '48px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>◆</div>
          <h4 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 600,
            color: '#c8e64a',
            marginBottom: '8px',
          }}>
            Nessun Executive Summary
          </h4>
          <p style={{
            fontSize: '13px',
            color: '#6b7280',
            maxWidth: '500px',
            margin: '0 auto 20px',
          }}>
            Clicca &quot;Genera Executive Summary&quot; per ottenere un&apos;analisi completa dello stato AS IS della presenza digitale del cliente, generata da Claude AI.
          </p>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            style={{
              padding: '10px 20px',
              background: '#c8e64a',
              color: '#111318',
              borderRadius: '8px',
              border: 'none',
              fontSize: '13px',
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'pointer',
            }}
          >
            Genera Executive Summary
          </button>
        </div>
      ) : hasNoAnalysis ? (
        /* No analysis state */
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '48px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>◎</div>
          <h4 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 600,
            color: '#f59e0b',
            marginBottom: '8px',
          }}>
            Nessuna Analisi Disponibile
          </h4>
          <p style={{
            fontSize: '13px',
            color: '#6b7280',
            maxWidth: '500px',
            margin: '0 auto',
          }}>
            Per generare l&apos;Executive Summary, lancia prima un&apos;analisi del dominio dalla tab &quot;Analisi&quot;.
          </p>
        </div>
      ) : null}
    </div>
  )
}
