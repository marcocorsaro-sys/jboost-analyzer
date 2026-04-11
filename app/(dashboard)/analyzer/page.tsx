'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDomain, isValidDomain } from '@/lib/utils'
import { MAX_COMPETITORS, DRIVERS } from '@/lib/constants'
import AnalysisProgress from '@/components/analyzer/AnalysisProgress'

export default function AnalyzerPage() {
  const [domain, setDomain] = useState('')
  const [country, setCountry] = useState('us')
  const [language, setLanguage] = useState('en')
  const [competitors, setCompetitors] = useState<string[]>([''])
  const [targetTopic, setTargetTopic] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [currentPhase, setCurrentPhase] = useState<string | null>(null)
  const [phaseDetail, setPhaseDetail] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [domainError, setDomainError] = useState<string | null>(null)

  const supabase = createClient()

  // Poll for analysis status updates (with Realtime as bonus)
  useEffect(() => {
    if (!analysisId || !isRunning) return

    // Polling fallback - checks every 2 seconds
    const pollInterval = setInterval(async () => {
      const { data } = await supabase
        .from('analyses')
        .select('status, current_phase, phase_detail, started_at, error_message')
        .eq('id', analysisId)
        .single()

      if (data) {
        setCurrentPhase(data.current_phase || null)
        setPhaseDetail(data.phase_detail || null)
        setStatus(data.status || null)
        if (data.started_at) setStartedAt(data.started_at)

        if (data.status === 'completed') {
          setIsRunning(false)
          clearInterval(pollInterval)
          window.location.href = `/results/${analysisId}`
        } else if (data.status === 'failed') {
          setIsRunning(false)
          clearInterval(pollInterval)
          setError(data.error_message || 'Analysis failed. Please try again.')
        }
      }
    }, 2000)

    // Also try Realtime subscription
    const channel = supabase
      .channel(`analysis-${analysisId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'analyses',
          filter: `id=eq.${analysisId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>
          setCurrentPhase(row.current_phase as string || null)
          setPhaseDetail(row.phase_detail as string || null)
          setStatus(row.status as string || null)
          if (row.started_at) setStartedAt(row.started_at as string)

          if (row.status === 'completed') {
            setIsRunning(false)
            clearInterval(pollInterval)
            window.location.href = `/results/${analysisId}`
          } else if (row.status === 'failed') {
            setIsRunning(false)
            clearInterval(pollInterval)
            setError(row.error_message as string || 'Analysis failed. Please try again.')
          }
        }
      )
      .subscribe()

    return () => {
      clearInterval(pollInterval)
      supabase.removeChannel(channel)
    }
  }, [analysisId, isRunning, supabase])

  // Real-time domain validation (Bug #10)
  useEffect(() => {
    if (!domain) { setDomainError(null); return }
    const clean = formatDomain(domain)
    if (clean && !isValidDomain(clean)) {
      setDomainError('Enter a valid domain (e.g., example.com)')
    } else {
      setDomainError(null)
    }
  }, [domain])

  const addCompetitor = () => {
    if (competitors.length < MAX_COMPETITORS) {
      setCompetitors([...competitors, ''])
    }
  }

  const removeCompetitor = (index: number) => {
    setCompetitors(competitors.filter((_, i) => i !== index))
  }

  const updateCompetitor = (index: number, value: string) => {
    const updated = [...competitors]
    updated[index] = value
    setCompetitors(updated)
  }

  const handleStartAnalysis = async () => {
    setError(null)

    const cleanDomain = formatDomain(domain)
    if (!isValidDomain(cleanDomain)) {
      setError('Please enter a valid domain (e.g., example.com)')
      return
    }

    const cleanCompetitors = competitors
      .map(c => formatDomain(c))
      .filter(c => c && isValidDomain(c))

    setIsRunning(true)
    setStatus('running')
    setCurrentPhase('initializing')
    setPhaseDetail('Creating analysis record...')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Insert analysis record
      const { data: analysis, error: insertError } = await supabase
        .from('analyses')
        .insert({
          user_id: user.id,
          domain: cleanDomain,
          country,
          language,
          target_topic: targetTopic || null,
          competitors: cleanCompetitors,
          status: 'running',
        })
        .select()
        .single()

      if (insertError) throw insertError

      setAnalysisId(analysis.id)
      setStartedAt(new Date().toISOString())

      // Invoke the run-analysis Edge Function (fire-and-forget)
      supabase.functions.invoke('run-analysis', {
        body: { analysisId: analysis.id },
      }).catch((err) => {
        console.error('Edge Function invocation error:', err)
        setError('Failed to start analysis. Please try again.')
        setIsRunning(false)
      })

      // Realtime subscription handles the rest via useEffect above

    } catch (err: unknown) {
      let message = 'Unknown error'
      if (err instanceof Error) {
        message = err.message
      } else if (err && typeof err === 'object' && 'message' in err) {
        message = String((err as Record<string, unknown>).message)
      } else if (typeof err === 'string') {
        message = err
      }
      console.error('Analysis start error:', err)
      setError(message)
      setIsRunning(false)
      setStatus(null)
      setCurrentPhase(null)
    }
  }

  return (
    <div className="max-w-3xl">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-4xl font-black leading-tight" style={{ color: 'var(--gray)' }}>
          Analyze your<br />
          <span style={{ color: 'var(--lime)', fontStyle: 'italic' }}>digital presence</span>.
        </h1>
        <p className="mt-4 text-sm" style={{ color: 'var(--gray)' }}>
          9-driver SEO/GEO analysis with competitor benchmarking, AI-powered insights, and actionable recommendations powered by the J-Boost framework.
        </p>
      </div>

      {/* Progress indicator (replaces old status bar) */}
      {isRunning && (
        <div className="mb-8">
          <AnalysisProgress
            currentPhase={currentPhase}
            phaseDetail={phaseDetail}
            status={status}
            startedAt={startedAt}
          />
        </div>
      )}

      {/* Analysis Form */}
      {!isRunning && (
        <div className="space-y-6">
          {/* Domain */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--lime)' }}>
              Domain
            </label>
            <input
              type="text"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              placeholder="example.com"
              disabled={isRunning}
              className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-colors"
              style={{
                background: 'var(--card)',
                border: `1px solid ${domainError ? 'var(--red)' : 'var(--border)'}`,
                color: 'var(--white)',
              }}
              onFocus={e => { if (!domainError) e.currentTarget.style.borderColor = 'var(--lime)' }}
              onBlur={e => { if (!domainError) e.currentTarget.style.borderColor = 'var(--border)' }}
            />
            {domainError ? (
              <p className="mt-1 text-xs" style={{ color: 'var(--red)' }}>{domainError}</p>
            ) : (
              <p className="mt-1 text-xs" style={{ color: 'var(--gray)' }}>
                Enter domain without protocol (e.g., example.com, not https://example.com)
              </p>
            )}
          </div>

          {/* Country & Language */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--lime)' }}>Country</label>
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                disabled={isRunning}
                className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--white)' }}
              >
                <option value="us">United States</option>
                <option value="gb">United Kingdom</option>
                <option value="it">Italy</option>
                <option value="de">Germany</option>
                <option value="fr">France</option>
                <option value="es">Spain</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--lime)' }}>Language</label>
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                disabled={isRunning}
                className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--white)' }}
              >
                <option value="en">English</option>
                <option value="it">Italian</option>
                <option value="de">German</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
              </select>
            </div>
          </div>

          {/* Competitors */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--lime)' }}>
              Competitors ({competitors.length}/{MAX_COMPETITORS})
            </label>
            <p className="text-xs mb-3" style={{ color: 'var(--gray)' }}>
              Add up to {MAX_COMPETITORS} competitor domains for comparative analysis to benchmark your performance.
            </p>
            <div className="space-y-2">
              {competitors.map((comp, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={comp}
                    onChange={e => updateCompetitor(i, e.target.value)}
                    placeholder={`competitor${i + 1}.com`}
                    disabled={isRunning}
                    className="flex-1 px-4 py-2.5 rounded-lg text-sm outline-none"
                    style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--white)' }}
                  />
                  {competitors.length > 1 && (
                    <button
                      onClick={() => removeCompetitor(i)}
                      disabled={isRunning}
                      className="px-3 rounded-lg text-sm"
                      style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--red)' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {competitors.length < MAX_COMPETITORS && (
              <button
                onClick={addCompetitor}
                disabled={isRunning}
                className="mt-2 text-xs font-medium"
                style={{ color: 'var(--teal)' }}
              >
                + Add competitor
              </button>
            )}
          </div>

          {/* Target Topic */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--lime)' }}>
              Target Topic
              <span className="ml-2 font-normal normal-case tracking-normal" style={{ color: 'var(--gray)' }}>
                (Optional)
              </span>
            </label>
            <input
              type="text"
              value={targetTopic}
              onChange={e => setTargetTopic(e.target.value)}
              placeholder="e.g., luxury watches, home heating systems..."
              disabled={isRunning}
              className="w-full px-4 py-3 rounded-lg text-sm outline-none"
              style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--white)' }}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--gray)' }}>
              Specify a topic to focus the Content, Discoverability, and AI Relevance analysis on a particular sector or niche.
            </p>
          </div>

          {/* Drivers Preview */}
          <div className="p-4 rounded-lg" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--lime-dim)' }}>
              9 Drivers to be analyzed
            </div>
            <div className="flex flex-wrap gap-2">
              {DRIVERS.map(d => (
                <span key={d.key} className="px-3 py-1 rounded-full text-xs font-medium"
                  style={{ background: 'rgba(200, 230, 74, 0.08)', color: 'var(--lime)' }}>
                  {d.label}
                </span>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 rounded-lg text-sm" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--red)' }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleStartAnalysis}
            disabled={isRunning || !domain || !!domainError}
            className="w-full py-4 rounded-lg text-base font-bold uppercase tracking-widest transition-all"
            style={{
              background: isRunning || !domain || domainError ? 'var(--card2)' : 'var(--lime)',
              color: isRunning || !domain || domainError ? 'var(--gray)' : 'var(--bg)',
              cursor: isRunning || !domain || domainError ? 'not-allowed' : 'pointer',
            }}
          >
            Start Complete Analysis
          </button>
        </div>
      )}
    </div>
  )
}
