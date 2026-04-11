'use client'

import { useState } from 'react'
import { useCompletion } from 'ai/react'
import { SENDER_ROLES, RECIPIENT_ROLES, SUMMARY_LENGTHS } from '@/lib/constants'

interface ExecutiveSummaryProps {
  analysisId: string
  domain: string
  overallScore: number | null
  driverResults: Record<string, unknown>
  companyContext?: Record<string, unknown>
}

export default function ExecutiveSummary({
  analysisId,
  domain,
  overallScore,
  driverResults,
  companyContext,
}: ExecutiveSummaryProps) {
  const [senderRole, setSenderRole] = useState(SENDER_ROLES[0])
  const [recipientRole, setRecipientRole] = useState(RECIPIENT_ROLES[0])
  const [wordCount, setWordCount] = useState(250)
  const [language, setLanguage] = useState<'en' | 'it'>('en')
  const [revisionInput, setRevisionInput] = useState('')

  const {
    completion: summary,
    complete: generateSummary,
    isLoading: isGenerating,
  } = useCompletion({
    api: '/api/llm/executive-summary',
  })

  const {
    completion: revisedSummary,
    complete: reviseSummary,
    isLoading: isRevising,
  } = useCompletion({
    api: '/api/llm/revise-summary',
  })

  const displaySummary = revisedSummary || summary

  async function handleGenerate() {
    await generateSummary('', {
      body: {
        analysisId,
        domain,
        overallScore,
        driverResults,
        companyContext,
        senderRole,
        recipientRole,
        wordCount,
        language,
      },
    })
  }

  async function handleRevise() {
    if (!revisionInput.trim()) return
    await reviseSummary('', {
      body: {
        currentSummary: displaySummary,
        userFeedback: revisionInput,
        domain,
        overallScore,
        driverResults,
        language,
      },
    })
    setRevisionInput('')
  }

  return (
    <div style={{
      background: '#1a1d24',
      borderRadius: '12px',
      border: '1px solid #2a2d35',
      padding: '24px',
    }}>
      <h3 style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '14px',
        fontWeight: 600,
        color: '#ffffff',
        marginBottom: '16px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        Executive Summary
      </h3>

      {/* Configuration */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '12px',
        marginBottom: '16px',
      }}>
        <div>
          <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>From</label>
          <select
            value={senderRole}
            onChange={(e) => setSenderRole(e.target.value as typeof senderRole)}
            style={{
              width: '100%',
              padding: '8px',
              background: '#111318',
              border: '1px solid #2a2d35',
              borderRadius: '6px',
              color: '#ffffff',
              fontSize: '12px',
            }}
          >
            {SENDER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>To</label>
          <select
            value={recipientRole}
            onChange={(e) => setRecipientRole(e.target.value as typeof recipientRole)}
            style={{
              width: '100%',
              padding: '8px',
              background: '#111318',
              border: '1px solid #2a2d35',
              borderRadius: '6px',
              color: '#ffffff',
              fontSize: '12px',
            }}
          >
            {RECIPIENT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Length</label>
          <select
            value={wordCount}
            onChange={(e) => setWordCount(Number(e.target.value))}
            style={{
              width: '100%',
              padding: '8px',
              background: '#111318',
              border: '1px solid #2a2d35',
              borderRadius: '6px',
              color: '#ffffff',
              fontSize: '12px',
            }}
          >
            {SUMMARY_LENGTHS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'en' | 'it')}
            style={{
              width: '100%',
              padding: '8px',
              background: '#111318',
              border: '1px solid #2a2d35',
              borderRadius: '6px',
              color: '#ffffff',
              fontSize: '12px',
            }}
          >
            <option value="en">English</option>
            <option value="it">Italiano</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        style={{
          padding: '10px 20px',
          background: isGenerating ? '#2a2d35' : '#c8e64a',
          color: isGenerating ? '#6b7280' : '#111318',
          border: 'none',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: isGenerating ? 'default' : 'pointer',
          marginBottom: '16px',
        }}
      >
        {isGenerating ? 'Generating...' : displaySummary ? 'Regenerate Summary' : 'Generate Summary'}
      </button>

      {/* Summary display */}
      {displaySummary && (
        <>
          <div style={{
            padding: '20px',
            background: '#111318',
            borderRadius: '10px',
            border: '1px solid #2a2d35',
            marginBottom: '16px',
          }}>
            <div style={{
              fontSize: '13px',
              color: '#e0e0e0',
              lineHeight: '1.7',
              whiteSpace: 'pre-wrap',
            }}>
              {displaySummary}
            </div>
          </div>

          {/* Revision chat */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={revisionInput}
              onChange={(e) => setRevisionInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRevise()}
              placeholder="Ask for changes... (e.g., 'Make it shorter', 'Focus more on SEO')"
              style={{
                flex: 1,
                padding: '10px 14px',
                background: '#111318',
                border: '1px solid #2a2d35',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '13px',
              }}
            />
            <button
              onClick={handleRevise}
              disabled={isRevising || !revisionInput.trim()}
              style={{
                padding: '10px 16px',
                background: isRevising ? '#2a2d35' : '#c8e64a',
                color: isRevising ? '#6b7280' : '#111318',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isRevising || !revisionInput.trim() ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isRevising ? 'Revising...' : 'Revise'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
