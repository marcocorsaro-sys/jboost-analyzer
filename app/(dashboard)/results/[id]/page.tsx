'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { DRIVERS, getScoreBand } from '@/lib/constants'
import ScoreDisplay from '@/components/analyzer/ScoreDisplay'
import SpiderChart from '@/components/analyzer/SpiderChart'
import DriverDetail from '@/components/analyzer/DriverDetail'
import PriorityMatrix from '@/components/analyzer/PriorityMatrix'
import ExecutiveSummary from '@/components/analyzer/ExecutiveSummary'
import Link from 'next/link'

interface DriverResultRow {
  driver_name: string
  score: number | null
  status: string
  issues: (string | Record<string, unknown>)[]
  solutions: unknown[]
  raw_data: Record<string, unknown>
}

interface CompetitorRow {
  competitor_domain: string
  scores: Record<string, number | null>
}

interface PriorityMatrixRow {
  opportunities: unknown[]
  issues: unknown[]
  improvements: unknown[]
  suggestions: unknown[]
}

export default function AnalysisDetailPage() {
  const params = useParams()
  const router = useRouter()
  const analysisId = params.id as string
  const supabase = createClient()

  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null)
  const [driverResults, setDriverResults] = useState<DriverResultRow[]>([])
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([])
  const [priorityMatrix, setPriorityMatrix] = useState<PriorityMatrixRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [generatingDriver, setGeneratingDriver] = useState<string | null>(null)
  const [generatingMatrix, setGeneratingMatrix] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)

    const [analysisRes, driversRes, competitorsRes, matrixRes] = await Promise.all([
      supabase.from('analyses').select('*').eq('id', analysisId).single(),
      supabase.from('driver_results').select('*').eq('analysis_id', analysisId),
      supabase.from('competitor_results').select('*').eq('analysis_id', analysisId),
      supabase.from('priority_matrix').select('*').eq('analysis_id', analysisId).single(),
    ])

    if (analysisRes.data) setAnalysis(analysisRes.data)
    if (driversRes.data) setDriverResults(driversRes.data as DriverResultRow[])
    if (competitorsRes.data) setCompetitors(competitorsRes.data as CompetitorRow[])
    if (matrixRes.data) setPriorityMatrix(matrixRes.data as PriorityMatrixRow)

    setLoading(false)
  }, [analysisId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function generateSolutions(driverName: string) {
    setGeneratingDriver(driverName)
    try {
      const dr = driverResults.find(d => d.driver_name === driverName)
      const res = await fetch('/api/llm/solutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisId,
          driverName,
          score: dr?.score,
          issues: dr?.issues ?? [],
          domain: analysis?.domain,
          companyContext: analysis?.company_context,
        }),
      })
      if (res.ok) {
        await fetchData() // Refresh
      }
    } catch (err) {
      console.error('Generate solutions error:', err)
    }
    setGeneratingDriver(null)
  }

  async function generatePriorityMatrix() {
    setGeneratingMatrix(true)
    try {
      const res = await fetch('/api/llm/priority-matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId }),
      })
      if (res.ok) {
        await fetchData()
      }
    } catch (err) {
      console.error('Generate matrix error:', err)
    }
    setGeneratingMatrix(false)
  }

  if (loading) {
    return (
      <div style={{ padding: '32px', color: '#6b7280', textAlign: 'center', marginTop: '60px' }}>
        Loading analysis...
      </div>
    )
  }

  if (!analysis) {
    return (
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <p style={{ color: '#ef4444', marginBottom: '16px' }}>Analysis not found.</p>
        <Link href="/results" style={{ color: '#c8e64a', textDecoration: 'none' }}>← Back to Results</Link>
      </div>
    )
  }

  const domain = analysis.domain as string
  const overallScore = analysis.overall_score as number | null
  const status = analysis.status as string
  const band = overallScore !== null ? getScoreBand(overallScore) : null

  // Build driver scores map for SpiderChart
  const driverScoresMap: Record<string, number | null> = {}
  driverResults.forEach(dr => {
    driverScoresMap[dr.driver_name] = dr.score
  })

  // Build driver results map for ExecutiveSummary
  const driverResultsMap: Record<string, { score: number | null; status: string }> = {}
  driverResults.forEach(dr => {
    driverResultsMap[dr.driver_name] = { score: dr.score, status: dr.status }
  })

  // Competitor data for SpiderChart
  const competitorChartData = competitors.map(c => ({
    domain: c.competitor_domain,
    scores: c.scores,
  }))

  // Band colors
  const BAND_COLORS: Record<string, string> = {
    green: '#22c55e', teal: '#14b8a6', amber: '#f59e0b', red: '#ef4444',
  }
  const bandColor = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'

  return (
    <div style={{ padding: '32px', maxWidth: '1200px' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <Link
          href="/results"
          style={{ color: '#6b7280', textDecoration: 'none', fontSize: '13px', display: 'inline-block', marginBottom: '12px' }}
        >
          ← Back to Results
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <ScoreDisplay score={overallScore} size="lg" />
          <div>
            <h1 style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '24px',
              fontWeight: 700,
              color: '#ffffff',
              marginBottom: '4px',
            }}>
              {domain}
            </h1>
            <div style={{ display: 'flex', gap: '12px', fontSize: '13px', color: '#6b7280' }}>
              <span style={{
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                background: status === 'completed' ? '#c8e64a15' : '#f59e0b15',
                color: status === 'completed' ? '#c8e64a' : '#f59e0b',
              }}>
                {status}
              </span>
              <span>{(analysis.country as string)?.toUpperCase()}</span>
              <span>{new Date(analysis.created_at as string).toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}</span>
              {analysis.target_topic ? <span>Topic: {String(analysis.target_topic)}</span> : null}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: '10px',
        marginBottom: '24px',
      }}>
        {DRIVERS.map(driver => {
          const dr = driverResults.find(r => r.driver_name === driver.key)
          const s = dr?.score ?? null
          const dBand = s !== null ? getScoreBand(s) : null
          const dColor = dBand ? BAND_COLORS[dBand.color] ?? '#6b7280' : '#6b7280'

          return (
            <div
              key={driver.key}
              style={{
                background: '#1a1d24',
                borderRadius: '10px',
                padding: '12px',
                border: '1px solid #2a2d35',
                textAlign: 'center',
              }}
            >
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '22px',
                fontWeight: 700,
                color: dColor,
                marginBottom: '4px',
              }}>
                {s ?? '—'}
              </div>
              <div style={{ fontSize: '10px', color: '#a0a0a0', fontWeight: 500 }}>
                {driver.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Spider Chart */}
      <div style={{ marginBottom: '24px' }}>
        <SpiderChart
          driverScores={driverScoresMap}
          competitorScores={competitorChartData}
        />
      </div>

      {/* Driver Details */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '16px',
          fontWeight: 600,
          color: '#ffffff',
          marginBottom: '12px',
        }}>
          Driver Analysis
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {DRIVERS.map(driver => {
            const dr = driverResults.find(r => r.driver_name === driver.key)
            return (
              <DriverDetail
                key={driver.key}
                driverName={driver.key}
                driverLabel={driver.label}
                score={dr?.score ?? null}
                status={dr?.status ?? 'no_results'}
                issues={(dr?.issues ?? []) as string[]}
                solutions={(dr?.solutions ?? []) as never[]}
                rawData={(dr?.raw_data ?? {}) as Record<string, unknown>}
                onGenerateSolutions={() => generateSolutions(driver.key)}
                isGenerating={generatingDriver === driver.key}
              />
            )
          })}
        </div>
      </div>

      {/* Priority Matrix */}
      <div style={{ marginBottom: '24px' }}>
        <PriorityMatrix
          opportunities={(priorityMatrix?.opportunities ?? []) as never[]}
          issues={(priorityMatrix?.issues ?? []) as never[]}
          improvements={(priorityMatrix?.improvements ?? []) as never[]}
          suggestions={(priorityMatrix?.suggestions ?? []) as never[]}
          onGenerate={generatePriorityMatrix}
          isGenerating={generatingMatrix}
          hasData={!!priorityMatrix}
        />
      </div>

      {/* Executive Summary */}
      <div style={{ marginBottom: '24px' }}>
        <ExecutiveSummary
          analysisId={analysisId}
          domain={domain}
          overallScore={overallScore}
          driverResults={driverResultsMap}
          companyContext={analysis.company_context as Record<string, unknown> | undefined}
        />
      </div>
    </div>
  )
}
