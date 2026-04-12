'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { DRIVERS, getScoreBand } from '@/lib/constants'
import { useLocale } from '@/lib/i18n/context'
import { formatLocalDate } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import ScoreDisplay from '@/components/analyzer/ScoreDisplay'
import SpiderChart from '@/components/analyzer/SpiderChart'
import DriverDetail from '@/components/analyzer/DriverDetail'
import PriorityMatrix from '@/components/analyzer/PriorityMatrix'
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
  const { locale, t } = useLocale()
  const analysisId = params.id as string
  const supabase = createClient()

  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null)
  const [driverResults, setDriverResults] = useState<DriverResultRow[]>([])
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([])
  const [priorityMatrix, setPriorityMatrix] = useState<PriorityMatrixRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [generatingDriver, setGeneratingDriver] = useState<string | null>(null)
  const [generatingMatrix, setGeneratingMatrix] = useState(false)
  const [clientName, setClientName] = useState<string | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)

    const [analysisRes, driversRes, competitorsRes, matrixRes] = await Promise.all([
      supabase.from('analyses').select('*').eq('id', analysisId).single(),
      supabase.from('driver_results').select('*').eq('analysis_id', analysisId),
      supabase.from('competitor_results').select('*').eq('analysis_id', analysisId),
      supabase.from('priority_matrix').select('*').eq('analysis_id', analysisId).single(),
    ])

    if (analysisRes.data) {
      setAnalysis(analysisRes.data)
      // Fetch client name if linked
      const cid = analysisRes.data.client_id
      if (cid) {
        setClientId(cid)
        const { data: clientData } = await supabase
          .from('clients')
          .select('name')
          .eq('id', cid)
          .single()
        if (clientData) setClientName(clientData.name)
      }
    }
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
          clientId,
          locale,
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
        body: JSON.stringify({ analysisId, clientId, locale }),
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
      <div className="p-8 text-gray-500 text-center mt-[60px]">
        {t('results.loadingAnalysis')}
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="p-8 text-center">
        <p className="text-destructive mb-4">{t('results.notFound')}</p>
        <Link href="/results" className="text-primary no-underline">{t('results.backToResults')}</Link>
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
    <div className="p-8 max-w-[1200px]">
      {/* Header */}
      <div className="mb-6">
        <div className="flex gap-3 mb-3 text-[13px]">
          <Link
            href="/results"
            className="text-gray-500 no-underline"
          >
            ← {t('results.backResults')}
          </Link>
          {clientName && clientId && (
            <>
              <span className="text-border">|</span>
              <Link
                href={`/clients/${clientId}`}
                className="text-primary no-underline"
              >
                ← {clientName}
              </Link>
            </>
          )}
        </div>

        <div className="flex items-center gap-5">
          <ScoreDisplay score={overallScore} size="lg" />
          <div>
            <h1 className="font-mono text-2xl font-bold text-foreground mb-1">
              {domain}
            </h1>
            <div className="flex gap-3 text-[13px] text-gray-500 items-center">
              <span className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                status === 'completed'
                  ? 'bg-primary/[0.08] text-primary'
                  : 'bg-amber-500/[0.08] text-amber-500'
              }`}>
                {status}
              </span>
              {clientName && (
                <Link
                  href={`/clients/${clientId}`}
                  className="px-2 py-0.5 rounded text-[11px] font-semibold bg-primary/[0.08] text-primary no-underline"
                >
                  {clientName}
                </Link>
              )}
              <span>{(analysis.country as string)?.toUpperCase()}</span>
              <span>{formatLocalDate(new Date(analysis.created_at as string), locale)}</span>
              {analysis.target_topic ? <span>Topic: {String(analysis.target_topic)}</span> : null}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2.5 mb-6">
        {DRIVERS.map(driver => {
          const dr = driverResults.find(r => r.driver_name === driver.key)
          const s = dr?.score ?? null
          const dBand = s !== null ? getScoreBand(s) : null
          const dColor = dBand ? BAND_COLORS[dBand.color] ?? '#6b7280' : '#6b7280'

          return (
            <div
              key={driver.key}
              className="bg-card rounded-xl p-3 border border-border text-center"
            >
              <div
                className="font-mono text-[22px] font-bold mb-1"
                style={{ color: dColor }}
              >
                {s ?? '—'}
              </div>
              <div className="text-[10px] text-[#a0a0a0] font-medium">
                {driver.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Spider Chart */}
      <div className="mb-6">
        <SpiderChart
          driverScores={driverScoresMap}
          competitorScores={competitorChartData}
        />
      </div>

      {/* Driver Details */}
      <div className="mb-6">
        <h2 className="font-mono text-base font-semibold text-foreground mb-3">
          {t('results.driverAnalysis')}
        </h2>
        <div className="flex flex-col gap-2">
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
      <div className="mb-6">
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

    </div>
  )
}
