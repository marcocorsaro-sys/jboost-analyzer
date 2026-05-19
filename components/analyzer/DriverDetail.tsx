'use client'

import { useState } from 'react'
import { getScoreBand } from '@/lib/constants'
import { DRIVER_METADATA } from '@/lib/drivers/metadata'
import type { DriverKey } from '@/lib/constants'

interface Solution {
  title: string
  description: string
  impact: string
  effort: string
  estimated_improvement: number
  timeframe: string
  category: string
}

interface DriverAgentQuestion {
  id: string
  text: string
  options?: string[]
}

interface DriverAgentTurn {
  role: 'user' | 'agent'
  content: string
  turn_idx: number
  timestamp: string
}

interface DriverAgentVerdict {
  observations?: string[]
  questions?: DriverAgentQuestion[]
  needs_dialogue?: boolean
  skipped?: boolean
  answered_at?: string
  turns?: DriverAgentTurn[]
  locked?: boolean
  turn_count?: number
}

interface DriverDetailProps {
  driverName: string
  driverLabel: string
  score: number | null
  status: string
  issues: (string | Record<string, unknown>)[]
  solutions: Solution[]
  rawData: Record<string, unknown>
  onGenerateSolutions?: () => void
  isGenerating?: boolean
  /** PR4: Per-driver interpreter agent verdict, if any. */
  agentVerdict?: DriverAgentVerdict | null
  /** PR4: Analysis id, required to POST answers back to the API. */
  analysisId?: string
  /** PR4: Called when the user submits an answer so the parent can refresh. */
  onAgentAnswered?: () => void
}

const BAND_COLORS: Record<string, string> = {
  green: '#22c55e',
  teal: '#14b8a6',
  amber: '#f59e0b',
  red: '#ef4444',
}

export default function DriverDetail({
  driverName,
  driverLabel,
  score,
  status,
  issues = [],
  solutions = [],
  rawData,
  onGenerateSolutions,
  isGenerating = false,
  agentVerdict,
  analysisId,
  onAgentAnswered,
}: DriverDetailProps) {
  const [expanded, setExpanded] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const band = score !== null ? getScoreBand(score) : null
  const color = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'

  const observations = agentVerdict?.observations ?? []
  const agentQuestions = agentVerdict?.questions ?? []
  const turns = agentVerdict?.turns ?? []
  const locked = agentVerdict?.locked ?? false
  const turnCount = agentVerdict?.turn_count ?? turns.filter(t => t.role === 'agent').length
  const hasAgentContent = observations.length > 0 || agentQuestions.length > 0 || turns.length > 0
  const needsDialogueBadge = !locked && agentQuestions.length > 0
  const meta = DRIVER_METADATA[driverName as DriverKey]
  const [showDetails, setShowDetails] = useState(false)

  // Per-driver rerun — independent re-execution of the agent loop.
  const [rerunning, setRerunning] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)
  async function handleRerun(e: React.MouseEvent) {
    e.stopPropagation()
    if (!analysisId) return
    setRerunning(true)
    setRerunError(null)
    try {
      const res = await fetch(
        `/api/analyses/${analysisId}/driver/${encodeURIComponent(driverName)}/rerun`,
        { method: 'POST', credentials: 'same-origin' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      onAgentAnswered?.()
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : 'rerun failed')
    } finally {
      setRerunning(false)
    }
  }

  async function handleSubmit() {
    if (!analysisId) return
    const trimmed: Record<string, string> = {}
    for (const [k, v] of Object.entries(answers)) {
      if (v && v.trim()) trimmed[k] = v.trim()
    }
    if (Object.keys(trimmed).length === 0) {
      setSubmitError('Fill in at least one answer')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(
        `/api/analyses/${analysisId}/driver/${encodeURIComponent(driverName)}/answer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: trimmed }),
          credentials: 'same-origin',
        },
      )
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${body}`)
      }
      setAnswers({})
      onAgentAnswered?.()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        background: '#1a1d24',
        borderRadius: '12px',
        border: '1px solid #2a2d35',
        overflow: 'hidden',
      }}
    >
      {/* Header — always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          cursor: 'pointer',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#1e2028')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Score */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 700,
            background: `${color}15`,
            color,
            flexShrink: 0,
          }}
        >
          {score ?? '—'}
        </div>

        {/* Name + status */}
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '14px',
            fontWeight: 600,
            color: '#ffffff',
          }}>
            {driverLabel}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
            {band?.label ?? status}
          </div>
        </div>

        {needsDialogueBadge && (
          <span
            title="The interpreter agent has questions for you"
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '10px',
              background: '#14b8a615',
              color: '#14b8a6',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              flexShrink: 0,
            }}
          >
            ●  Agent
          </span>
        )}

        {/* Progress bar */}
        <div style={{ width: '120px', flexShrink: 0 }}>
          <div style={{
            height: '6px',
            borderRadius: '3px',
            background: '#2a2d35',
            overflow: 'hidden',
          }}>
            <div
              style={{
                height: '100%',
                width: `${score ?? 0}%`,
                background: color,
                borderRadius: '3px',
                transition: 'width 0.5s ease',
              }}
            />
          </div>
        </div>

        {/* Expand icon */}
        <span style={{
          color: '#6b7280',
          fontSize: '16px',
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
        }}>
          ▶
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '0 20px 20px', borderTop: '1px solid #2a2d35' }}>
          {/* Rerun bar — independent re-execution of this driver agent. */}
          {analysisId && (
            <div style={{
              marginTop: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}>
              <div style={{ fontSize: '11px', color: '#6b7280', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Driver indipendente
              </div>
              <button
                type="button"
                onClick={handleRerun}
                disabled={rerunning}
                style={{
                  padding: '6px 14px',
                  background: rerunning ? '#2a2d35' : '#1e2028',
                  color: rerunning ? '#6b7280' : '#c8e64a',
                  border: '1px solid #c8e64a40',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  cursor: rerunning ? 'default' : 'pointer',
                }}
                title="Re-esegue solo questo driver, indipendente dall'analisi"
              >
                {rerunning ? '↻ Rilancio…' : '↻ Rilancia driver'}
              </button>
            </div>
          )}
          {rerunError && (
            <div style={{ marginTop: '6px', fontSize: '11px', color: '#ef4444' }}>
              {rerunError}
            </div>
          )}

          {/* Co-pilot quality loop summary — always visible when populated.
              Was previously hidden inside the "Dettagli" toggle; now in evidence
              so the user sees verdict + retries + interpretation up-front. */}
          {(() => {
            const aq = rawData?.agent_quality as
              | {
                  attempts?: number
                  passed?: boolean
                  final_score?: number
                  final_verdict?: string
                  interpretation?: string
                  source?: string
                  history?: Array<{ attempt: number; verdict: { verdict: string; score: number; issues?: string[]; guidance?: string } }>
                }
              | undefined
            if (!aq) return null
            const verdictColor = aq.passed ? '#22c55e' : aq.final_verdict === 'fail' ? '#ef4444' : '#f59e0b'
            return (
              <div style={{ marginTop: '14px' }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#c8e64a',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '6px',
                }}>
                  Co-pilot quality
                </div>
                <div style={{
                  padding: '10px 12px',
                  background: '#1e2028',
                  borderRadius: '8px',
                  border: '1px solid #2a2d35',
                  fontSize: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}>
                  <div>
                    <span style={{ color: verdictColor, fontWeight: 700, textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>
                      {aq.final_verdict ?? '—'}
                    </span>
                    <span style={{ color: '#6b7280', marginLeft: '8px' }}>
                      tentativi: {aq.attempts ?? '—'} · quality score: {aq.final_score ?? '—'}/100
                    </span>
                  </div>
                  {aq.interpretation && (
                    <div style={{ color: '#cfcfcf', lineHeight: 1.5 }}>{aq.interpretation}</div>
                  )}
                  {aq.history && aq.history.length > 1 && (
                    <details>
                      <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>
                        Storia tentativi
                      </summary>
                      <div style={{ marginTop: '4px' }}>
                        {aq.history.map((h, i) => (
                          <div key={i} style={{ color: '#9ca3af', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>
                            attempt {h.attempt}: {h.verdict.verdict} ({h.verdict.score}/100)
                            {h.verdict.guidance && i < aq.history!.length - 1 && (
                              <div style={{ paddingLeft: '14px', color: '#9ca3af' }}>
                                → guidance: {h.verdict.guidance.slice(0, 200)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Dettagli — transparency on data sources, formula, LLM layer */}
          {meta && (
            <div style={{ marginTop: '16px' }}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowDetails(!showDetails); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#6b7280',
                  fontSize: '11px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span style={{ transform: showDetails ? 'rotate(90deg)' : 'rotate(0)', display: 'inline-block', transition: 'transform 0.2s' }}>▶</span>
                Dettagli — cosa è stato fatto per questo driver
              </button>
              {showDetails && (
                <div style={{
                  marginTop: '10px',
                  padding: '14px',
                  background: '#111318',
                  borderRadius: '8px',
                  border: '1px solid #2a2d35',
                  fontSize: '12px',
                  color: '#a0a0a0',
                  lineHeight: '1.6',
                }}>
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>1. Cosa misura</div>
                    {meta.whatItMeasures}
                  </div>

                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>2. Quale dato è studiato</div>
                    {meta.dataSpecifics}
                  </div>

                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>3. Con che tecnologia</div>
                    {meta.technology}
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {meta.sources.map((s, i) => (
                        <div key={i} style={{
                          padding: '8px 10px',
                          background: '#1e2028',
                          borderRadius: '6px',
                        }}>
                          <div style={{ color: '#14b8a6', fontSize: '11px', fontWeight: 600 }}>{s.provider}</div>
                          <div style={{ color: '#ffffff', fontSize: '12px' }}>{s.endpoint}</div>
                          <div style={{ fontSize: '11px', color: '#6b7280', fontFamily: "'JetBrains Mono', monospace", marginTop: '2px' }}>
                            {s.fields.join(' · ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>4. Come si calcola il punteggio</div>
                    <div style={{ marginBottom: '6px' }}>{meta.formula}</div>
                    <div style={{
                      padding: '8px 10px',
                      background: '#1e2028',
                      borderRadius: '6px',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '11px',
                      color: '#cfcfcf',
                      lineHeight: '1.5',
                    }}>
                      <span style={{ color: '#14b8a6', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Esempio numerico:</span>{' '}
                      {meta.formulaExample}
                    </div>
                  </div>

                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>5. Bande di punteggio</div>
                    <div style={{ marginBottom: '6px', fontSize: '11px', color: '#9ca3af' }}>{meta.scoring}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {meta.scoreBands.map((b, i) => {
                        const color = b.color === 'green' ? '#22c55e' : b.color === 'teal' ? '#14b8a6' : b.color === 'amber' ? '#f59e0b' : '#ef4444'
                        return (
                          <div key={i} style={{
                            display: 'flex',
                            gap: '10px',
                            alignItems: 'center',
                            padding: '6px 10px',
                            background: '#1e2028',
                            borderRadius: '6px',
                            borderLeft: `3px solid ${color}`,
                          }}>
                            <span style={{ color, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', minWidth: '70px' }}>
                              {b.range}
                            </span>
                            <span style={{ color: '#ffffff', fontWeight: 600, fontSize: '12px', minWidth: '90px' }}>{b.label}</span>
                            <span style={{ color: '#9ca3af', fontSize: '11px', lineHeight: '1.4' }}>{b.meaning}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>6. Come diventa una considerazione</div>
                    {meta.considerationsLogic}
                  </div>

                  <div>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>7. Livello LLM</div>
                    {meta.llmLayer}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Excellence — detailed LLM-driven analysis (findings + recommendations).
              Populated for pilot agents (AI Relevance, Authority); other drivers
              will gain it incrementally. */}
          {(() => {
            const aq = rawData?.agent_quality as { excellence?: {
              executive_summary?: string
              findings?: Array<{ title: string; detail: string; signal: 'positive' | 'concern' | 'neutral'; evidence: string[] }>
              recommendations?: Array<{ title: string; detail: string; priority: 'high' | 'medium' | 'low'; effort: string }>
              clarification_questions?: Array<{ id: string; text: string; options?: string[] }>
              skipped?: boolean
            } } | undefined
            const ex = aq?.excellence
            if (!ex || ex.skipped) return null
            const sigColor = (s: string) => s === 'positive' ? '#22c55e' : s === 'concern' ? '#ef4444' : '#6b7280'
            const prColor = (p: string) => p === 'high' ? '#ef4444' : p === 'medium' ? '#f59e0b' : '#6b7280'
            return (
              <div style={{ marginTop: '18px' }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#14b8a6',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '8px',
                }}>
                  Analisi dettagliata
                </div>
                {ex.executive_summary && (
                  <div style={{
                    padding: '12px 14px',
                    background: '#14b8a610',
                    borderLeft: '3px solid #14b8a6',
                    borderRadius: '6px',
                    fontSize: '13px',
                    color: '#ffffff',
                    lineHeight: '1.6',
                    marginBottom: '12px',
                  }}>
                    {ex.executive_summary}
                  </div>
                )}
                {ex.findings && ex.findings.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                    {ex.findings.map((f, i) => (
                      <div key={i} style={{
                        padding: '10px 12px',
                        background: '#1e2028',
                        borderRadius: '6px',
                        borderLeft: `3px solid ${sigColor(f.signal)}`,
                      }}>
                        <div style={{ color: '#ffffff', fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                          {f.title}
                        </div>
                        <div style={{ fontSize: '12px', color: '#cfcfcf', lineHeight: '1.6' }}>{f.detail}</div>
                        {f.evidence && f.evidence.length > 0 && (
                          <div style={{
                            marginTop: '6px',
                            fontSize: '11px',
                            color: '#9ca3af',
                            fontFamily: "'JetBrains Mono', monospace",
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '6px',
                          }}>
                            {f.evidence.map((e, j) => (
                              <span key={j} style={{
                                padding: '2px 8px',
                                background: '#111318',
                                borderRadius: '4px',
                                border: '1px solid #2a2d35',
                              }}>{e}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {ex.recommendations && ex.recommendations.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '10px',
                      fontWeight: 700,
                      color: '#c8e64a',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                    }}>
                      Raccomandazioni
                    </div>
                    {ex.recommendations.map((r, i) => (
                      <div key={i} style={{
                        padding: '10px 12px',
                        background: '#1e2028',
                        borderRadius: '6px',
                        borderLeft: `3px solid ${prColor(r.priority)}`,
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '4px',
                        }}>
                          <div style={{ color: '#ffffff', fontWeight: 600, fontSize: '13px' }}>{r.title}</div>
                          <div style={{ display: 'flex', gap: '6px', fontFamily: "'JetBrains Mono', monospace" }}>
                            <span style={{
                              fontSize: '10px',
                              color: prColor(r.priority),
                              textTransform: 'uppercase',
                              fontWeight: 700,
                            }}>{r.priority}</span>
                            <span style={{ fontSize: '10px', color: '#6b7280' }}>{r.effort}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: '12px', color: '#cfcfcf', lineHeight: '1.6' }}>{r.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Driver Interpreter Agent — chat thread + observations */}
          {hasAgentContent && (
            <div style={{ marginTop: '16px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
              }}>
                <h4 style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#14b8a6',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  margin: 0,
                }}>
                  Agent — {driverLabel}
                </h4>
                {turnCount > 0 && (
                  <span style={{ fontSize: '10px', color: '#6b7280', fontFamily: "'JetBrains Mono', monospace" }}>
                    Turno {turnCount} di 3 {locked ? '· chiuso' : ''}
                  </span>
                )}
              </div>

              {/* Latest observations (always show the freshest synthesis) */}
              {observations.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#a0a0a0', lineHeight: '1.6' }}>
                  {observations.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              )}

              {/* Conversation history: prior user answers */}
              {turns.filter(t => t.role === 'user').length > 0 && (
                <details style={{ marginTop: '10px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: '11px', color: '#6b7280', fontFamily: "'JetBrains Mono', monospace" }}>
                    Conversazione precedente ({turns.filter(t => t.role === 'user').length} risposte tue)
                  </summary>
                  <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {turns.map((t, i) => (
                      <div key={i} style={{
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        background: t.role === 'user' ? '#14b8a615' : '#1e2028',
                        borderLeft: `3px solid ${t.role === 'user' ? '#14b8a6' : '#6b7280'}`,
                        color: '#a0a0a0',
                        whiteSpace: 'pre-wrap',
                      }}>
                        <div style={{ fontSize: '10px', color: t.role === 'user' ? '#14b8a6' : '#6b7280', fontWeight: 600, marginBottom: '2px' }}>
                          {t.role === 'user' ? 'TU' : 'AGENT'} · turno {t.turn_idx}
                        </div>
                        {t.role === 'agent' ? (() => {
                          try {
                            const p = JSON.parse(t.content);
                            const obs: string[] = p.observations || [];
                            const qs: { text: string }[] = p.questions || [];
                            return (
                              <>
                                {obs.length > 0 && <div>{obs.join(' · ')}</div>}
                                {qs.length > 0 && <div style={{ marginTop: '4px', fontStyle: 'italic' }}>{qs.map(q => `Q: ${q.text}`).join('  ')}</div>}
                              </>
                            );
                          } catch {
                            return <div>{t.content}</div>;
                          }
                        })() : (
                          <div>{t.content}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Current open questions — form */}
              {agentQuestions.length > 0 && analysisId && !locked && (
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {agentQuestions.map((q) => (
                    <div key={q.id} style={{
                      padding: '12px',
                      background: '#1e2028',
                      borderRadius: '8px',
                      border: '1px solid #2a2d35',
                    }}>
                      <label style={{ display: 'block', fontSize: '13px', color: '#ffffff', marginBottom: '8px' }}>
                        {q.text}
                      </label>
                      {q.options && q.options.length > 0 ? (
                        <select
                          value={answers[q.id] || ''}
                          onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}
                          disabled={submitting}
                          style={{
                            width: '100%', padding: '8px 10px', background: '#111318',
                            border: '1px solid #2a2d35', borderRadius: '6px', color: '#ffffff',
                            fontSize: '13px', outline: 'none',
                          }}
                        >
                          <option value="">—</option>
                          {q.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <textarea
                          value={answers[q.id] || ''}
                          onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}
                          disabled={submitting}
                          rows={2}
                          placeholder="Your answer…"
                          style={{
                            width: '100%', padding: '8px 10px', background: '#111318',
                            border: '1px solid #2a2d35', borderRadius: '6px', color: '#ffffff',
                            fontSize: '13px', fontFamily: 'inherit', outline: 'none', resize: 'vertical',
                          }}
                        />
                      )}
                    </div>
                  ))}
                  {submitError && <div style={{ fontSize: '12px', color: '#ef4444' }}>{submitError}</div>}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
                    disabled={submitting}
                    style={{
                      alignSelf: 'flex-start',
                      padding: '8px 14px',
                      background: submitting ? '#2a2d35' : '#14b8a6',
                      color: submitting ? '#6b7280' : '#ffffff',
                      border: 'none', borderRadius: '6px', fontSize: '12px',
                      fontWeight: 600,
                      cursor: submitting ? 'default' : 'pointer',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}
                  >
                    {submitting ? 'Saving…' : 'Send answer'}
                  </button>
                </div>
              )}

              {locked && (
                <div style={{ marginTop: '10px', fontSize: '11px', color: '#14b8a6' }}>
                  ✓ Conversazione chiusa — il contesto è salvato per i prossimi run.
                </div>
              )}
            </div>
          )}

          {/* Issues */}
          {issues.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h4 style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                fontWeight: 600,
                color: '#ef4444',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '8px',
              }}>
                Issues Found
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {issues.map((issue, i) => {
                  const issueObj = typeof issue === 'object' && issue !== null ? issue as Record<string, unknown> : null
                  const title = issueObj ? String(issueObj.title || '') : String(issue)
                  const description = issueObj ? String(issueObj.description || '') : ''
                  const severity = issueObj ? String(issueObj.severity || 'medium') : 'medium'
                  const sevColor = severity === 'high' ? '#ef4444' : severity === 'medium' ? '#f59e0b' : '#6b7280'

                  return (
                    <div key={i} style={{
                      fontSize: '13px',
                      color: '#a0a0a0',
                      padding: '8px 12px',
                      background: `${sevColor}10`,
                      borderRadius: '6px',
                      borderLeft: `3px solid ${sevColor}`,
                    }}>
                      <div style={{ fontWeight: 600, color: '#ffffff', marginBottom: description ? '4px' : 0 }}>
                        {title}
                      </div>
                      {description && <div style={{ fontSize: '12px' }}>{description}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Solutions */}
          {solutions.length > 0 ? (
            <div style={{ marginTop: '16px' }}>
              <h4 style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                fontWeight: 600,
                color: '#c8e64a',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '8px',
              }}>
                Recommended Solutions
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {solutions.map((sol, i) => (
                  <div key={i} style={{
                    padding: '12px 16px',
                    background: '#1e2028',
                    borderRadius: '8px',
                    border: '1px solid #2a2d35',
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '6px',
                    }}>
                      <span style={{
                        fontWeight: 600,
                        fontSize: '13px',
                        color: '#ffffff',
                      }}>
                        {sol.title}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: sol.impact === 'high' ? '#22c55e15' : sol.impact === 'medium' ? '#f59e0b15' : '#6b728015',
                        color: sol.impact === 'high' ? '#22c55e' : sol.impact === 'medium' ? '#f59e0b' : '#6b7280',
                        fontWeight: 600,
                      }}>
                        {sol.impact} impact
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#a0a0a0', lineHeight: '1.5', margin: '0 0 8px' }}>
                      {sol.description}
                    </p>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#6b7280' }}>
                      <span>+{sol.estimated_improvement} pts</span>
                      <span>{sol.timeframe}</span>
                      <span>Effort: {sol.effort || (sol as unknown as Record<string, string>).effort_level || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : onGenerateSolutions ? (
            <div style={{ marginTop: '16px' }}>
              <button
                onClick={(e) => { e.stopPropagation(); onGenerateSolutions(); }}
                disabled={isGenerating}
                style={{
                  padding: '8px 16px',
                  background: isGenerating ? '#2a2d35' : '#c8e64a',
                  color: isGenerating ? '#6b7280' : '#111318',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isGenerating ? 'default' : 'pointer',
                }}
              >
                {isGenerating ? 'Generating Solutions...' : 'Generate AI Solutions'}
              </button>
            </div>
          ) : null}

          {/* Raw data */}
          {rawData && Object.keys(rawData).length > 0 && (
            <details style={{ marginTop: '16px' }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: '11px',
                color: '#6b7280',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                Raw Data
              </summary>
              <pre style={{
                marginTop: '8px',
                padding: '12px',
                background: '#111318',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#a0a0a0',
                overflow: 'auto',
                maxHeight: '200px',
              }}>
                {JSON.stringify(rawData, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
