'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatDomain, isValidDomain } from '@/lib/utils'
import { MAX_COMPETITORS, DRIVERS } from '@/lib/constants'
import { useLocale } from '@/lib/i18n'
import AnalysisProgress from '@/components/analyzer/AnalysisProgress'
import DomainAutocomplete from '@/components/ui/DomainAutocomplete'
import Link from 'next/link'

interface ClientOption {
  id: string
  name: string
  domain: string | null
}

export default function AnalyzerPage() {
  const { t } = useLocale()
  const searchParams = useSearchParams()
  const preselectedClient = searchParams.get('client') || ''
  const preselectedDomain = searchParams.get('domain') || ''

  const [domain, setDomain] = useState(preselectedDomain)
  const [country, setCountry] = useState('us')
  const [language, setLanguage] = useState('en')
  const [competitors, setCompetitors] = useState<string[]>([''])
  const [targetTopic, setTargetTopic] = useState('')
  const [pauseBetweenPhases, setPauseBetweenPhases] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [pausedAtPhase, setPausedAtPhase] = useState<string | null>(null)
  const [isResuming, setIsResuming] = useState(false)

  interface CriticAnomaly { severity: 'info' | 'warning' | 'critical'; message: string; evidence: string }
  interface CriticQuestion { id: string; text: string; options?: string[] }
  interface CriticVerdict { ok: boolean; anomalies: CriticAnomaly[]; questions: CriticQuestion[]; skipped?: boolean }

  const [criticVerdict, setCriticVerdict] = useState<CriticVerdict | null>(null)
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [currentPhase, setCurrentPhase] = useState<string | null>(null)
  const [phaseDetail, setPhaseDetail] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [domainError, setDomainError] = useState<string | null>(null)

  // Client picker state
  const [clients, setClients] = useState<ClientOption[]>([])
  const [selectedClientId, setSelectedClientId] = useState<string>(preselectedClient)
  const [loadingClients, setLoadingClients] = useState(true)

  const supabase = createClient()

  // Fetch clients for picker
  useEffect(() => {
    async function fetchClients() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Only show active (lifecycle) clients in the analyzer picker.
      const { data } = await supabase
        .from('clients')
        .select('id, name, domain')
        .eq('user_id', user.id)
        .eq('lifecycle_stage', 'active')
        .neq('status', 'archived')
        .order('name')

      setClients(data || [])
      setLoadingClients(false)
    }
    fetchClients()
  }, [])

  // When client is selected, pre-fill domain
  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId)
    if (clientId) {
      const client = clients.find(c => c.id === clientId)
      if (client?.domain) {
        setDomain(client.domain)
      }
    }
  }

  // Poll for analysis status updates (with Realtime as bonus)
  useEffect(() => {
    if (!analysisId || !isRunning) return

    // Polling fallback - checks every 2 seconds
    const pollInterval = setInterval(async () => {
      const { data } = await supabase
        .from('analyses')
        .select('status, current_phase, phase_detail, started_at, error_message, paused_at_phase')
        .eq('id', analysisId)
        .single()

      if (data) {
        setCurrentPhase(data.current_phase || null)
        setPhaseDetail(data.phase_detail || null)
        setStatus(data.status || null)
        if (data.started_at) setStartedAt(data.started_at)

        if (data.status === 'completed') {
          setIsRunning(false)
          setPausedAtPhase(null)
          clearInterval(pollInterval)
          window.location.href = `/results/${analysisId}`
        } else if (data.status === 'failed') {
          setIsRunning(false)
          setPausedAtPhase(null)
          clearInterval(pollInterval)
          setError(data.error_message || 'Analysis failed. Please try again.')
        } else if (data.status === 'paused') {
          setIsRunning(false)
          const phase = data.paused_at_phase || data.current_phase || null
          setPausedAtPhase(phase)
          // Fetch the checkpoint payload so we can render the critic verdict.
          if (phase) {
            const { data: ckpt } = await supabase
              .from('analysis_checkpoints')
              .select('payload')
              .eq('analysis_id', analysisId)
              .eq('phase', phase)
              .maybeSingle()
            const critic = (ckpt?.payload as Record<string, unknown> | null)?.critic as CriticVerdict | undefined
            setCriticVerdict(critic ?? null)
          }
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
            setPausedAtPhase(null)
            clearInterval(pollInterval)
            window.location.href = `/results/${analysisId}`
          } else if (row.status === 'failed') {
            setIsRunning(false)
            setPausedAtPhase(null)
            clearInterval(pollInterval)
            setError(row.error_message as string || 'Analysis failed. Please try again.')
          } else if (row.status === 'paused') {
            setIsRunning(false)
            setPausedAtPhase((row.paused_at_phase as string) || (row.current_phase as string) || null)
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

      // Insert analysis record — now with optional client_id
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
          pause_between_phases: pauseBetweenPhases,
          ...(selectedClientId ? { client_id: selectedClientId } : {}),
        })
        .select()
        .single()

      if (insertError) throw insertError

      setAnalysisId(analysis.id)
      setStartedAt(new Date().toISOString())

      // Trigger the analysis run (fire-and-forget). Two paths gated by a
      // feature flag during the Phase 7 migration: the new Next.js Node
      // route at /api/analyses/run, or the legacy Supabase Edge Function.
      // Set NEXT_PUBLIC_USE_NEXT_RUN_ANALYSIS=true (Vercel env) to switch
      // this UI to the new path. Default = legacy edge function.
      const useNextRoute =
        process.env.NEXT_PUBLIC_USE_NEXT_RUN_ANALYSIS === 'true'

      const invokePromise: Promise<unknown> = useNextRoute
        ? fetch('/api/analyses/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysisId: analysis.id }),
            credentials: 'same-origin',
          }).then(async (res) => {
            if (!res.ok && res.status !== 202) {
              const body = await res.text().catch(() => '')
              throw new Error(`/api/analyses/run failed: HTTP ${res.status} ${body}`)
            }
          })
        : supabase.functions
            .invoke('run-analysis', {
              body: { analysisId: analysis.id },
            })
            .then(({ error }) => {
              if (error) throw error
            })

      invokePromise.catch((err) => {
        console.error('Run-analysis invocation error:', err)
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

  const handleResume = async (decision: 'continue' | 'stop') => {
    if (!analysisId) return
    setIsResuming(true)
    setError(null)
    try {
      // Only send answers for questions the user actually filled in.
      const trimmed: Record<string, string> = {}
      for (const [k, v] of Object.entries(questionAnswers)) {
        if (v && v.trim()) trimmed[k] = v.trim()
      }
      const res = await fetch(`/api/analyses/${analysisId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          ...(decision === 'continue' && Object.keys(trimmed).length > 0 ? { answers: trimmed } : {}),
        }),
        credentials: 'same-origin',
      })
      if (!res.ok && res.status !== 202) {
        const body = await res.text().catch(() => '')
        throw new Error(`Resume failed: HTTP ${res.status} ${body}`)
      }
      if (decision === 'continue') {
        setIsRunning(true)
        setPausedAtPhase(null)
        setCriticVerdict(null)
        setQuestionAnswers({})
        setStatus('running')
      } else {
        setStatus('failed')
        setPausedAtPhase(null)
        setCriticVerdict(null)
      }
    } catch (err) {
      console.error('Resume error:', err)
      setError(err instanceof Error ? err.message : 'Resume failed')
    } finally {
      setIsResuming(false)
    }
  }

  const selectedClient = clients.find(c => c.id === selectedClientId)

  return (
    <div className="max-w-3xl">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-4xl font-black leading-tight" style={{ color: 'var(--gray)' }}>
          {t('analyzer.title1')}<br />
          <span style={{ color: 'var(--lime)', fontStyle: 'italic' }}>{t('analyzer.title2')}</span>.
        </h1>
        <p className="mt-4 text-sm" style={{ color: 'var(--gray)' }}>
          {t('analyzer.subtitle')}
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

      {/* Paused state — checkpoint review (Continue / Stop) */}
      {!isRunning && status === 'paused' && analysisId && (
        <div
          className="mb-8 p-5 rounded-lg"
          style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
          }}
        >
          <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--amber, #f59e0b)' }}>
            {t('analyzer.analysisPaused')}
          </div>
          <div className="text-sm mb-1" style={{ color: 'var(--white)' }}>
            <span style={{ color: 'var(--gray)' }}>{t('analyzer.pausedAfter')}: </span>
            <span style={{ fontFamily: 'monospace' }}>{pausedAtPhase || currentPhase || '—'}</span>
          </div>
          <p className="text-xs mb-4" style={{ color: 'var(--gray)' }}>
            {t('analyzer.reviewCheckpoint')}
          </p>

          {criticVerdict && criticVerdict.anomalies.length > 0 && (
            <div className="mb-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--lime-dim)' }}>
                {t('analyzer.criticAnomalies')}
              </div>
              {criticVerdict.anomalies.map((a, i) => {
                const sevColor = a.severity === 'critical' ? 'var(--red)' : a.severity === 'warning' ? 'var(--amber, #f59e0b)' : 'var(--teal)'
                return (
                  <div key={i} className="p-3 rounded text-xs" style={{ background: 'hsl(var(--card))', border: `1px solid ${sevColor}` }}>
                    <div style={{ color: sevColor, fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {a.severity}
                    </div>
                    <div style={{ color: 'var(--white)', marginBottom: '4px' }}>{a.message}</div>
                    {a.evidence && (
                      <div style={{ color: 'var(--gray)', fontFamily: 'monospace', fontSize: '11px' }}>{a.evidence}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {criticVerdict && criticVerdict.questions.length > 0 && (
            <div className="mb-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--lime-dim)' }}>
                {t('analyzer.criticQuestions')}
              </div>
              {criticVerdict.questions.map((q) => (
                <div key={q.id} className="p-3 rounded" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <label className="block text-sm mb-2" style={{ color: 'var(--white)' }}>{q.text}</label>
                  {q.options && q.options.length > 0 ? (
                    <select
                      value={questionAnswers[q.id] || ''}
                      onChange={e => setQuestionAnswers({ ...questionAnswers, [q.id]: e.target.value })}
                      disabled={isResuming}
                      className="w-full px-3 py-2 rounded text-sm outline-none"
                      style={{ background: 'hsl(var(--bg))', border: '1px solid hsl(var(--border))', color: 'var(--white)' }}
                    >
                      <option value="">—</option>
                      {q.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <textarea
                      value={questionAnswers[q.id] || ''}
                      onChange={e => setQuestionAnswers({ ...questionAnswers, [q.id]: e.target.value })}
                      disabled={isResuming}
                      rows={2}
                      className="w-full px-3 py-2 rounded text-sm outline-none"
                      style={{ background: 'hsl(var(--bg))', border: '1px solid hsl(var(--border))', color: 'var(--white)', fontFamily: 'inherit' }}
                      placeholder={t('analyzer.answerPlaceholder')}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => handleResume('continue')}
              disabled={isResuming}
              className="px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-widest"
              style={{
                background: 'var(--lime)',
                color: 'var(--bg)',
                cursor: isResuming ? 'not-allowed' : 'pointer',
                opacity: isResuming ? 0.6 : 1,
              }}
            >
              {t('analyzer.continueAnalysis')}
            </button>
            <button
              onClick={() => handleResume('stop')}
              disabled={isResuming}
              className="px-4 py-2 rounded-lg text-sm font-semibold uppercase tracking-widest"
              style={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                color: 'var(--red)',
                cursor: isResuming ? 'not-allowed' : 'pointer',
                opacity: isResuming ? 0.6 : 1,
              }}
            >
              {t('analyzer.stopAnalysis')}
            </button>
          </div>
        </div>
      )}

      {/* Analysis Form */}
      {!isRunning && status !== 'paused' && (
        <div className="space-y-6">

          {/* Client Picker */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--lime)' }}>
              {t('analyzer.client')}
              <span className="ml-2 font-normal normal-case tracking-normal" style={{ color: 'var(--gray)' }}>
                {t('analyzer.optionalClient')}
              </span>
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                value={selectedClientId}
                onChange={e => handleClientChange(e.target.value)}
                disabled={isRunning || loadingClients}
                className="flex-1 px-4 py-3 rounded-lg text-sm outline-none"
                style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'var(--white)' }}
              >
                <option value="">{t('analyzer.noClient')}</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.domain ? `(${c.domain})` : ''}
                  </option>
                ))}
              </select>
              <Link
                href="/clients/new"
                style={{
                  padding: '10px 14px',
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  color: 'var(--lime)',
                  fontSize: '13px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('analyzer.new')}
              </Link>
            </div>
            {selectedClient && (
              <p className="mt-1 text-xs" style={{ color: 'var(--teal)' }}>
                {t('analyzer.analysisWillBeAssociated')} &quot;{selectedClient.name}&quot;
              </p>
            )}
          </div>

          {/* Domain */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--lime)' }}>
              {t('analyzer.domain')}
            </label>
            <DomainAutocomplete
              value={domain}
              onChange={setDomain}
              placeholder="example.com"
              disabled={isRunning}
              error={!!domainError}
              className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-colors"
              style={{
                background: 'hsl(var(--card))',
                border: `1px solid ${domainError ? 'var(--red)' : 'hsl(var(--border))'}`,
                color: 'var(--white)',
              }}
              onFocus={e => { if (!domainError) e.currentTarget.style.borderColor = 'var(--lime)' }}
              onBlur={e => { if (!domainError) e.currentTarget.style.borderColor = 'hsl(var(--border))' }}
            />
            {domainError ? (
              <p className="mt-1 text-xs" style={{ color: 'var(--red)' }}>{domainError}</p>
            ) : (
              <p className="mt-1 text-xs" style={{ color: 'var(--gray)' }}>
                {t('analyzer.domainHelp')}
              </p>
            )}
          </div>

          {/* Country & Language */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--lime)' }}>{t('analyzer.country')}</label>
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                disabled={isRunning}
                className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'var(--white)' }}
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
                style={{ color: 'var(--lime)' }}>{t('analyzer.language')}</label>
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                disabled={isRunning}
                className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'var(--white)' }}
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
              {t('analyzer.competitors')} ({competitors.length}/{MAX_COMPETITORS})
            </label>
            <p className="text-xs mb-3" style={{ color: 'var(--gray)' }}>
              {t('analyzer.competitorHelp').replace('{max}', String(MAX_COMPETITORS))}
            </p>
            <div className="space-y-2">
              {competitors.map((comp, i) => (
                <div key={i} className="flex gap-2">
                  <DomainAutocomplete
                    value={comp}
                    onChange={v => updateCompetitor(i, v)}
                    placeholder={`competitor${i + 1}.com`}
                    disabled={isRunning}
                    className="flex-1 px-4 py-2.5 rounded-lg text-sm outline-none"
                    style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'var(--white)' }}
                  />
                  {competitors.length > 1 && (
                    <button
                      onClick={() => removeCompetitor(i)}
                      disabled={isRunning}
                      className="px-3 rounded-lg text-sm"
                      style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'var(--red)' }}
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
                {t('analyzer.addCompetitor')}
              </button>
            )}
          </div>

          {/* Target Topic */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--lime)' }}>
              {t('analyzer.targetTopic')}
              <span className="ml-2 font-normal normal-case tracking-normal" style={{ color: 'var(--gray)' }}>
                {t('analyzer.targetTopicOptional')}
              </span>
            </label>
            <input
              type="text"
              value={targetTopic}
              onChange={e => setTargetTopic(e.target.value)}
              placeholder="e.g., luxury watches, home heating systems..."
              disabled={isRunning}
              className="w-full px-4 py-3 rounded-lg text-sm outline-none"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'var(--white)' }}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--gray)' }}>
              {t('analyzer.targetTopicHelp')}
            </p>
          </div>

          {/* Pause between phases (debug / step-by-step review) */}
          <div className="p-4 rounded-lg" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pauseBetweenPhases}
                onChange={e => setPauseBetweenPhases(e.target.checked)}
                disabled={isRunning}
                style={{ marginTop: '3px', accentColor: 'var(--lime)' }}
              />
              <span>
                <span className="text-sm font-semibold" style={{ color: 'var(--white)' }}>
                  {t('analyzer.pauseBetweenPhases')}
                </span>
                <p className="mt-1 text-xs" style={{ color: 'var(--gray)' }}>
                  {t('analyzer.pauseBetweenPhasesHelp')}
                </p>
              </span>
            </label>
          </div>

          {/* Drivers Preview */}
          <div className="p-4 rounded-lg" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--lime-dim)' }}>
              {t('analyzer.driversPreview')}
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
            {t('analyzer.startAnalysis')}
          </button>
        </div>
      )}
    </div>
  )
}
