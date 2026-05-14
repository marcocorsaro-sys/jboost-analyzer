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
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>Cosa misura</div>
                    {meta.whatItMeasures}
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '6px' }}>Fonti dati</div>
                    {meta.sources.map((s, i) => (
                      <div key={i} style={{
                        padding: '8px 10px',
                        background: '#1e2028',
                        borderRadius: '6px',
                        marginBottom: '6px',
                      }}>
                        <div style={{ color: '#14b8a6', fontSize: '11px', fontWeight: 600 }}>{s.provider}</div>
                        <div style={{ color: '#ffffff', fontSize: '12px' }}>{s.endpoint}</div>
                        <div style={{ fontSize: '11px', color: '#6b7280', fontFamily: "'JetBrains Mono', monospace", marginTop: '2px' }}>
                          {s.fields.join(' · ')}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>Formula</div>
                    {meta.formula}
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>Scoring</div>
                    {meta.scoring}
                  </div>
                  <div>
                    <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: '4px' }}>Livello LLM</div>
                    {meta.llmLayer}
                  </div>
                </div>
              )}
            </div>
          )}

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
