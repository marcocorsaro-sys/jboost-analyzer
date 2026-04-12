import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { DRIVERS, getScoreBand, SCORING_INFO } from '@/lib/constants'

// This route reads Supabase auth cookies, which forces per-request rendering.
// Marking it dynamic suppresses the build-time DYNAMIC_SERVER_USAGE warning.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const analysisId = req.nextUrl.searchParams.get('analysisId')
    if (!analysisId) {
      return NextResponse.json({ error: 'analysisId required' }, { status: 400 })
    }

    // Fetch analysis with all related data
    const [
      { data: analysis },
      { data: driverResults },
      { data: competitorResults },
      { data: priorityMatrix },
    ] = await Promise.all([
      supabase.from('analyses').select('*').eq('id', analysisId).single(),
      supabase.from('driver_results').select('*').eq('analysis_id', analysisId),
      supabase.from('competitor_results').select('*').eq('analysis_id', analysisId),
      supabase.from('priority_matrix').select('*').eq('analysis_id', analysisId).single(),
    ])

    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
    }

    // Generate HTML for PDF (server-side rendering)
    const html = generatePdfHtml(analysis, driverResults || [], competitorResults || [], priorityMatrix)

    // Return HTML that can be printed to PDF via browser
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="jboost-analysis-${analysis.domain}.html"`,
      },
    })
  } catch (error) {
    console.error('PDF export error:', error)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

function generatePdfHtml(
  analysis: Record<string, unknown>,
  driverResults: Record<string, unknown>[],
  competitorResults: Record<string, unknown>[],
  priorityMatrix: Record<string, unknown> | null
): string {
  const domain = String(analysis.domain || '')
  const overallScore = analysis.overall_score as number | null
  const band = overallScore !== null ? getScoreBand(overallScore) : null

  const bandColor = (score: number | null) => {
    if (score === null) return '#6b7280'
    const b = getScoreBand(score)
    if (!b) return '#6b7280'
    const colors: Record<string, string> = { red: '#ef4444', amber: '#f59e0b', teal: '#14b8a6', green: '#22c55e' }
    return colors[b.color] || '#6b7280'
  }

  const driversHtml = DRIVERS.map((d) => {
    const result = driverResults.find((r) => r.driver_name === d.key)
    const score = result?.score as number | null
    const issues = (result?.issues || []) as { title: string; severity: string }[]
    const solutions = (result?.solutions || []) as { title: string; impact: string; timeframe: string }[]

    return `
      <div class="driver-card">
        <div class="driver-header">
          <span class="driver-name">${d.label}</span>
          <span class="driver-score" style="color: ${bandColor(score)}">${score ?? 'N/A'}</span>
        </div>
        ${issues.length > 0 ? `
          <div class="issues">
            <strong>Issues:</strong>
            <ul>${issues.map((i) => `<li><span class="severity ${i.severity}">${i.severity}</span> ${i.title}</li>`).join('')}</ul>
          </div>
        ` : ''}
        ${solutions.length > 0 ? `
          <div class="solutions">
            <strong>Solutions:</strong>
            <ul>${solutions.map((s) => `<li><strong>${s.title}</strong> — Impact: ${s.impact}, ${s.timeframe}</li>`).join('')}</ul>
          </div>
        ` : ''}
      </div>
    `
  }).join('')

  const competitorsHtml = competitorResults.length > 0
    ? `<div class="section">
        <h2>Competitor Comparison</h2>
        <table>
          <thead><tr><th>Driver</th><th>${domain}</th>${competitorResults.map((c) => `<th>${c.competitor_domain}</th>`).join('')}</tr></thead>
          <tbody>
            ${DRIVERS.map((d) => {
              const mainScore = (driverResults.find((r) => r.driver_name === d.key)?.score as number | null) ?? null
              return `<tr>
                <td>${d.label}</td>
                <td style="color: ${bandColor(mainScore)}; font-weight: 700">${mainScore ?? '—'}</td>
                ${competitorResults.map((c) => {
                  const scores = c.scores as Record<string, number | null>
                  const s = scores?.[d.key] ?? null
                  return `<td style="color: ${bandColor(s)}">${s ?? '—'}</td>`
                }).join('')}
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>JBoost Analysis — ${domain}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a2e; background: #fff; padding: 40px; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    h2 { font-size: 20px; margin: 32px 0 16px; color: #1a1a2e; border-bottom: 2px solid #c8e64a; padding-bottom: 8px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 1px solid #e5e7eb; }
    .overall-score { font-size: 48px; font-weight: 800; }
    .meta { color: #6b7280; font-size: 13px; }
    .scoring-info { background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 24px; font-size: 12px; color: #6b7280; }
    .driver-card { padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 12px; }
    .driver-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .driver-name { font-weight: 600; font-size: 15px; }
    .driver-score { font-size: 24px; font-weight: 800; }
    .issues, .solutions { margin-top: 8px; font-size: 13px; }
    .issues ul, .solutions ul { margin-left: 16px; margin-top: 4px; }
    .issues li, .solutions li { margin-bottom: 4px; }
    .severity { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 1px 6px; border-radius: 3px; }
    .severity.high { background: #fee2e2; color: #ef4444; }
    .severity.medium { background: #fef3c7; color: #f59e0b; }
    .severity.low { background: #e5e7eb; color: #6b7280; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px 12px; text-align: center; border: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
    @media print { body { padding: 20px; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>JBoost Analysis</h1>
      <div class="meta">${domain} — ${new Date(analysis.created_at as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
    </div>
    <div class="overall-score" style="color: ${bandColor(overallScore)}">${overallScore ?? 'N/A'}</div>
  </div>

  <div class="scoring-info">
    <strong>${SCORING_INFO.title}:</strong> ${SCORING_INFO.description}
  </div>

  <h2>Driver Scores</h2>
  ${driversHtml}

  ${competitorsHtml}

  <div class="footer">
    Generated by JBoost Analyzer — ${new Date().toISOString().split('T')[0]}
  </div>

  <script class="no-print">
    // Auto-trigger print dialog for PDF download
    window.onload = () => { window.print(); }
  </script>
</body>
</html>`
}
