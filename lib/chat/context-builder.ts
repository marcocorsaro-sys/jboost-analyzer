import { createClient } from '@/lib/supabase/server'

// ─── Chat Context (full client data for Ask J) ─────────────────

export interface ClientContext {
  client: {
    name: string
    domain: string | null
    industry: string | null
    contact_name: string | null
    notes: string | null
  }
  latestAnalysis: {
    overall_score: number | null
    completed_at: string | null
    domain: string
    company_context: Record<string, unknown> | null
    drivers: {
      name: string
      score: number | null
      status: string
      previousScore: number | null
      topIssues: string[]
      topSolutions: string[]
    }[]
  } | null
  previousAnalysis: {
    overall_score: number | null
    completed_at: string | null
  } | null
  analysesCount: number
  competitorScores: {
    domain: string
    scores: Record<string, number | null>
  }[]
  martechStack: { category: string; tool_name: string; confidence: number }[]
  knowledgeFiles: {
    file_name: string
    file_type: string | null
    extracted_text: string | null
    created_at: string
  }[]
  executiveSummary: string | null
}

/**
 * Build full context for a client to inject into the AI system prompt.
 * Loads ALL available data: analysis details with issues/solutions,
 * company context, competitors, knowledge base files, executive summary.
 */
export async function buildClientContext(clientId: string, _userId: string): Promise<ClientContext | null> {
  const supabase = await createClient()

  // 1. Client info. Access is enforced by RLS via client_members; do not
  //    filter by user_id so shared clients remain visible to editors/viewers.
  const { data: client } = await supabase
    .from('clients')
    .select('name, domain, industry, contact_name, notes')
    .eq('id', clientId)
    .single()

  if (!client) return null

  // 2. Last 2 completed analyses (for delta)
  const { data: analyses } = await supabase
    .from('analyses')
    .select('id, overall_score, completed_at, domain, company_context')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(2)

  const latestAnalysis = analyses?.[0] ?? null
  const previousAnalysis = analyses?.[1] ?? null

  // 3. Driver results with issues/solutions for latest analysis
  let currentDrivers: {
    driver_name: string
    score: number | null
    status: string
    issues: unknown[]
    solutions: unknown[]
  }[] = []

  if (latestAnalysis) {
    const { data: driverData } = await supabase
      .from('driver_results')
      .select('driver_name, score, status, issues, solutions')
      .eq('analysis_id', latestAnalysis.id)

    currentDrivers = driverData || []
  }

  // 4. Previous driver scores (for delta)
  let previousDriverMap: Record<string, number | null> = {}
  if (previousAnalysis) {
    const { data: prevDrivers } = await supabase
      .from('driver_results')
      .select('driver_name, score')
      .eq('analysis_id', previousAnalysis.id)

    for (const d of prevDrivers || []) {
      previousDriverMap[d.driver_name] = d.score
    }
  }

  // 5. Competitor results for latest analysis
  let competitorScores: { domain: string; scores: Record<string, number | null> }[] = []
  if (latestAnalysis) {
    const { data: competitors } = await supabase
      .from('competitor_results')
      .select('competitor_domain, scores')
      .eq('analysis_id', latestAnalysis.id)

    competitorScores = (competitors || []).map(c => ({
      domain: c.competitor_domain,
      scores: c.scores as Record<string, number | null>,
    }))
  }

  // 6. Analyses count
  const { count: analysesCount } = await supabase
    .from('analyses')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'completed')

  // 7. MarTech stack
  const { data: martech } = await supabase
    .from('client_martech')
    .select('category, tool_name, confidence')
    .eq('client_id', clientId)

  // 8. Knowledge Base files with extracted text
  const { data: knowledgeFiles } = await supabase
    .from('client_files')
    .select('file_name, file_type, extracted_text, created_at')
    .eq('client_id', clientId)
    .in('extraction_status', ['completed', 'unsupported'])
    .order('created_at', { ascending: false })

  // 9. Latest Executive Summary
  const { data: latestSummary } = await supabase
    .from('executive_summaries')
    .select('content')
    .eq('client_id', clientId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single()

  // Build driver details with deltas
  const drivers = currentDrivers.map(d => {
    const issues = (d.issues || []) as { title?: string; description?: string }[]
    const solutions = (d.solutions || []) as { title?: string; description?: string }[]

    return {
      name: d.driver_name,
      score: d.score,
      status: d.status,
      previousScore: previousDriverMap[d.driver_name] ?? null,
      topIssues: issues.slice(0, 3).map(i =>
        typeof i === 'string' ? i : (i.title || i.description || 'Issue')
      ),
      topSolutions: solutions.slice(0, 2).map(s =>
        typeof s === 'string' ? s : (s.title || s.description || 'Solution')
      ),
    }
  })

  return {
    client,
    latestAnalysis: latestAnalysis
      ? {
          overall_score: latestAnalysis.overall_score,
          completed_at: latestAnalysis.completed_at,
          domain: latestAnalysis.domain,
          company_context: latestAnalysis.company_context as Record<string, unknown> | null,
          drivers,
        }
      : null,
    previousAnalysis: previousAnalysis
      ? {
          overall_score: previousAnalysis.overall_score,
          completed_at: previousAnalysis.completed_at,
        }
      : null,
    analysesCount: analysesCount ?? 0,
    competitorScores,
    martechStack: martech || [],
    knowledgeFiles: (knowledgeFiles || []).map(f => ({
      file_name: f.file_name,
      file_type: f.file_type,
      extracted_text: f.extracted_text,
      created_at: f.created_at,
    })),
    executiveSummary: latestSummary?.content ?? null,
  }
}

// ─── Token budgets for context formatting ───────────────────────
const MAX_KNOWLEDGE_TOTAL_CHARS = 30_000
const MAX_KNOWLEDGE_PER_FILE_CHARS = 5_000
const MAX_EXECUTIVE_SUMMARY_CHARS = 3_000

/**
 * Format client context into a comprehensive text block for the system prompt.
 * Includes all available data with token budgeting to stay within limits.
 */
export function formatContextForPrompt(ctx: ClientContext): string {
  const lines: string[] = []

  // ── Client Info ──
  lines.push(`## Cliente: ${ctx.client.name}`)
  if (ctx.client.domain) lines.push(`Dominio: ${ctx.client.domain}`)
  if (ctx.client.industry) lines.push(`Settore: ${ctx.client.industry}`)
  if (ctx.client.contact_name) lines.push(`Contatto: ${ctx.client.contact_name}`)
  if (ctx.client.notes) lines.push(`Note: ${ctx.client.notes}`)
  lines.push(`Totale analisi completate: ${ctx.analysesCount}`)
  lines.push('')

  // ── Latest Analysis ──
  if (ctx.latestAnalysis) {
    const date = ctx.latestAnalysis.completed_at
      ? new Date(ctx.latestAnalysis.completed_at).toLocaleDateString('it-IT', {
          day: '2-digit', month: 'long', year: 'numeric',
        })
      : 'N/A'
    lines.push(`## Ultima Analisi — ${date}`)
    lines.push(`Score Complessivo: ${ctx.latestAnalysis.overall_score ?? 'N/A'}/100`)
    lines.push(`Dominio analizzato: ${ctx.latestAnalysis.domain}`)

    // Delta vs previous
    if (ctx.previousAnalysis) {
      const prevDate = ctx.previousAnalysis.completed_at
        ? new Date(ctx.previousAnalysis.completed_at).toLocaleDateString('it-IT', {
            day: '2-digit', month: 'long', year: 'numeric',
          })
        : 'N/A'
      const prevScore = ctx.previousAnalysis.overall_score
      const currScore = ctx.latestAnalysis.overall_score
      if (prevScore !== null && currScore !== null) {
        const delta = currScore - prevScore
        const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
        lines.push(`Score Precedente: ${prevScore}/100 (${prevDate}) — Delta: ${arrow} ${delta > 0 ? '+' : ''}${delta}`)
      }
    }
    lines.push('')

    // ── Company Context ──
    if (ctx.latestAnalysis.company_context) {
      const cc = ctx.latestAnalysis.company_context
      lines.push('## Contesto Aziendale')
      if (cc.company_profile) lines.push(`Profilo: ${cc.company_profile}`)
      if (cc.market_scenario) lines.push(`Scenario di mercato: ${cc.market_scenario}`)
      if (cc.main_challenges && Array.isArray(cc.main_challenges)) {
        lines.push(`Sfide principali: ${(cc.main_challenges as string[]).join(', ')}`)
      }
      if (cc.industry_trends && Array.isArray(cc.industry_trends)) {
        lines.push(`Trend di settore: ${(cc.industry_trends as string[]).join(', ')}`)
      }
      lines.push('')
    }

    // ── Driver Details (sorted by score ascending — worst first) ──
    lines.push('## Analisi Driver (9 driver SEO)')
    const sorted = [...ctx.latestAnalysis.drivers].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))

    for (const d of sorted) {
      const band = d.score !== null
        ? d.score >= 81 ? 'Eccellente' : d.score >= 61 ? 'Buono' : d.score >= 41 ? 'Da migliorare' : 'Critico'
        : 'N/A'
      let line = `### ${d.name}: ${d.score ?? 'N/A'}/100 [${band}]`
      if (d.previousScore !== null && d.score !== null) {
        const delta = d.score - d.previousScore
        const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
        line += ` (precedente: ${d.previousScore}, delta: ${arrow}${delta > 0 ? '+' : ''}${delta})`
      }
      lines.push(line)
      lines.push(`Status: ${d.status}`)
      if (d.topIssues.length > 0) {
        lines.push(`Problemi principali:`)
        for (const issue of d.topIssues) {
          lines.push(`  - ${issue}`)
        }
      }
      if (d.topSolutions.length > 0) {
        lines.push(`Soluzioni suggerite:`)
        for (const sol of d.topSolutions) {
          lines.push(`  - ${sol}`)
        }
      }
      lines.push('')
    }
  } else {
    lines.push('## Nessuna analisi completata per questo cliente.')
    lines.push('')
  }

  // ── Competitor Benchmarks ──
  if (ctx.competitorScores.length > 0) {
    lines.push('## Benchmark Competitivo')
    for (const c of ctx.competitorScores) {
      const scores = Object.entries(c.scores)
        .map(([driver, score]) => `${driver}: ${score ?? 'N/A'}`)
        .join(', ')
      lines.push(`- ${c.domain}: ${scores}`)
    }
    lines.push('')
  }

  // ── MarTech Stack ──
  if (ctx.martechStack.length > 0) {
    lines.push('## Stack MarTech Rilevato')
    const grouped: Record<string, string[]> = {}
    for (const t of ctx.martechStack) {
      if (!grouped[t.category]) grouped[t.category] = []
      grouped[t.category].push(`${t.tool_name} (${Math.round(t.confidence * 100)}%)`)
    }
    for (const [cat, tools] of Object.entries(grouped)) {
      lines.push(`- ${cat}: ${tools.join(', ')}`)
    }
    lines.push('')
  }

  // ── Knowledge Base Documents ──
  if (ctx.knowledgeFiles.length > 0) {
    lines.push('## Knowledge Base — Documenti Caricati')
    lines.push(`${ctx.knowledgeFiles.length} documenti disponibili:`)
    lines.push('')

    let totalKnowledgeChars = 0
    for (const f of ctx.knowledgeFiles) {
      if (totalKnowledgeChars >= MAX_KNOWLEDGE_TOTAL_CHARS) {
        lines.push(`[... altri ${ctx.knowledgeFiles.length - ctx.knowledgeFiles.indexOf(f)} documenti non inclusi per limiti di spazio]`)
        break
      }

      const date = new Date(f.created_at).toLocaleDateString('it-IT', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
      lines.push(`### Documento: ${f.file_name} (${date})`)

      if (f.extracted_text) {
        const budgetRemaining = MAX_KNOWLEDGE_TOTAL_CHARS - totalKnowledgeChars
        const maxForThisFile = Math.min(MAX_KNOWLEDGE_PER_FILE_CHARS, budgetRemaining)
        let text = f.extracted_text
        if (text.length > maxForThisFile) {
          text = text.substring(0, maxForThisFile) + '\n[... contenuto troncato]'
        }
        lines.push('```')
        lines.push(text)
        lines.push('```')
        totalKnowledgeChars += text.length
      } else {
        lines.push(`[File di tipo ${f.file_type || 'sconosciuto'} — testo non estratto]`)
      }
      lines.push('')
    }
  }

  // ── Executive Summary ──
  if (ctx.executiveSummary) {
    lines.push('## Ultimo Executive Summary Generato')
    let summary = ctx.executiveSummary
    if (summary.length > MAX_EXECUTIVE_SUMMARY_CHARS) {
      summary = summary.substring(0, MAX_EXECUTIVE_SUMMARY_CHARS) + '\n[... executive summary troncato]'
    }
    lines.push(summary)
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Executive Summary Context ──────────────────────────────────

export interface ExecutiveSummaryContext {
  client: {
    name: string
    domain: string | null
    industry: string | null
    notes: string | null
  }
  latestAnalysis: {
    id: string
    overall_score: number | null
    completed_at: string | null
    domain: string
    company_context: Record<string, unknown> | null
  } | null
  driverDetails: {
    name: string
    score: number | null
    previousScore: number | null
    status: string
    topIssues: string[]
    topSolutions: string[]
  }[]
  previousAnalysis: {
    overall_score: number | null
    completed_at: string | null
  } | null
  competitorScores: {
    domain: string
    scores: Record<string, number | null>
  }[]
  martechStack: { category: string; tool_name: string; confidence: number }[]
  analysesCount: number
}

/**
 * Build rich context for Executive Summary generation.
 * Fetches latest + previous analysis, driver details with issues/solutions,
 * competitors, martech stack, and company context.
 */
export async function buildExecutiveSummaryContext(
  clientId: string,
  _userId: string
): Promise<ExecutiveSummaryContext | null> {
  const supabase = await createClient()

  // 1. Client info. Access is enforced by RLS / client_members (editors and
  //    viewers can still read a client they have been shared on).
  const { data: client } = await supabase
    .from('clients')
    .select('name, domain, industry, notes')
    .eq('id', clientId)
    .single()

  if (!client) return null

  // 2. Last 2 completed analyses (for delta)
  const { data: analyses } = await supabase
    .from('analyses')
    .select('id, overall_score, completed_at, domain, company_context')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(2)

  const latestAnalysis = analyses?.[0] ?? null
  const previousAnalysis = analyses?.[1] ?? null

  // 3. Driver results for latest analysis (with issues + solutions)
  let currentDrivers: {
    driver_name: string
    score: number | null
    status: string
    issues: unknown[]
    solutions: unknown[]
  }[] = []

  if (latestAnalysis) {
    const { data: driverData } = await supabase
      .from('driver_results')
      .select('driver_name, score, status, issues, solutions')
      .eq('analysis_id', latestAnalysis.id)

    currentDrivers = driverData || []
  }

  // 4. Driver scores from previous analysis (for delta)
  let previousDriverMap: Record<string, number | null> = {}
  if (previousAnalysis) {
    const { data: prevDrivers } = await supabase
      .from('driver_results')
      .select('driver_name, score')
      .eq('analysis_id', previousAnalysis.id)

    for (const d of prevDrivers || []) {
      previousDriverMap[d.driver_name] = d.score
    }
  }

  // 5. Competitor results for latest analysis
  let competitorScores: { domain: string; scores: Record<string, number | null> }[] = []
  if (latestAnalysis) {
    const { data: competitors } = await supabase
      .from('competitor_results')
      .select('competitor_domain, scores')
      .eq('analysis_id', latestAnalysis.id)

    competitorScores = (competitors || []).map(c => ({
      domain: c.competitor_domain,
      scores: c.scores as Record<string, number | null>,
    }))
  }

  // 6. MarTech stack
  const { data: martech } = await supabase
    .from('client_martech')
    .select('category, tool_name, confidence')
    .eq('client_id', clientId)

  // 7. Analyses count
  const { count: analysesCount } = await supabase
    .from('analyses')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'completed')

  // Build driver details with deltas
  const driverDetails = currentDrivers.map(d => {
    const issues = (d.issues || []) as { title?: string; description?: string }[]
    const solutions = (d.solutions || []) as { title?: string; description?: string }[]

    return {
      name: d.driver_name,
      score: d.score,
      previousScore: previousDriverMap[d.driver_name] ?? null,
      status: d.status,
      topIssues: issues.slice(0, 3).map(i =>
        typeof i === 'string' ? i : (i.title || i.description || 'Issue')
      ),
      topSolutions: solutions.slice(0, 2).map(s =>
        typeof s === 'string' ? s : (s.title || s.description || 'Solution')
      ),
    }
  })

  return {
    client,
    latestAnalysis: latestAnalysis
      ? {
          id: latestAnalysis.id,
          overall_score: latestAnalysis.overall_score,
          completed_at: latestAnalysis.completed_at,
          domain: latestAnalysis.domain,
          company_context: latestAnalysis.company_context as Record<string, unknown> | null,
        }
      : null,
    driverDetails,
    previousAnalysis: previousAnalysis
      ? {
          overall_score: previousAnalysis.overall_score,
          completed_at: previousAnalysis.completed_at,
        }
      : null,
    competitorScores,
    martechStack: martech || [],
    analysesCount: analysesCount ?? 0,
  }
}

/**
 * Format Executive Summary context into a structured data block for the Claude prompt.
 */
export function formatExecutiveSummaryData(ctx: ExecutiveSummaryContext): string {
  const lines: string[] = []

  // Client header
  lines.push(`# Dati Cliente: ${ctx.client.name}`)
  if (ctx.client.domain) lines.push(`Dominio: ${ctx.client.domain}`)
  if (ctx.client.industry) lines.push(`Settore: ${ctx.client.industry}`)
  if (ctx.client.notes) lines.push(`Note: ${ctx.client.notes}`)
  lines.push(`Totale analisi completate: ${ctx.analysesCount}`)
  lines.push('')

  // Latest analysis
  if (ctx.latestAnalysis) {
    const date = ctx.latestAnalysis.completed_at
      ? new Date(ctx.latestAnalysis.completed_at).toLocaleDateString('it-IT', {
          day: '2-digit', month: 'long', year: 'numeric'
        })
      : 'N/A'
    lines.push(`## Ultima Analisi — ${date}`)
    lines.push(`Score Complessivo: ${ctx.latestAnalysis.overall_score ?? 'N/A'}/100`)

    // Delta vs previous
    if (ctx.previousAnalysis) {
      const prevDate = ctx.previousAnalysis.completed_at
        ? new Date(ctx.previousAnalysis.completed_at).toLocaleDateString('it-IT', {
            day: '2-digit', month: 'long', year: 'numeric'
          })
        : 'N/A'
      const prevScore = ctx.previousAnalysis.overall_score
      const currScore = ctx.latestAnalysis.overall_score
      if (prevScore !== null && currScore !== null) {
        const delta = currScore - prevScore
        const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
        lines.push(`Score Precedente: ${prevScore}/100 (${prevDate}) — Delta: ${arrow} ${delta > 0 ? '+' : ''}${delta}`)
      }
    }
    lines.push('')

    // Company context
    if (ctx.latestAnalysis.company_context) {
      const cc = ctx.latestAnalysis.company_context
      lines.push('## Contesto Aziendale')
      if (cc.company_profile) lines.push(`Profilo: ${cc.company_profile}`)
      if (cc.market_scenario) lines.push(`Scenario di mercato: ${cc.market_scenario}`)
      if (cc.main_challenges && Array.isArray(cc.main_challenges)) {
        lines.push(`Sfide principali: ${(cc.main_challenges as string[]).join(', ')}`)
      }
      if (cc.industry_trends && Array.isArray(cc.industry_trends)) {
        lines.push(`Trend di settore: ${(cc.industry_trends as string[]).join(', ')}`)
      }
      lines.push('')
    }

    // Driver details
    lines.push('## Driver Results (9 driver)')
    // Sort by score ascending (worst first)
    const sorted = [...ctx.driverDetails].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))

    for (const d of sorted) {
      const band = d.score !== null
        ? d.score >= 81 ? 'Eccellente' : d.score >= 61 ? 'Buono' : d.score >= 41 ? 'Da migliorare' : 'Critico'
        : 'N/A'
      let line = `### ${d.name}: ${d.score ?? 'N/A'}/100 [${band}]`
      if (d.previousScore !== null && d.score !== null) {
        const delta = d.score - d.previousScore
        const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
        line += ` (precedente: ${d.previousScore}, delta: ${arrow}${delta > 0 ? '+' : ''}${delta})`
      }
      lines.push(line)
      lines.push(`Status: ${d.status}`)
      if (d.topIssues.length > 0) {
        lines.push(`Problemi principali:`)
        for (const issue of d.topIssues) {
          lines.push(`  - ${issue}`)
        }
      }
      if (d.topSolutions.length > 0) {
        lines.push(`Soluzioni suggerite:`)
        for (const sol of d.topSolutions) {
          lines.push(`  - ${sol}`)
        }
      }
      lines.push('')
    }
  }

  // Competitor benchmarks
  if (ctx.competitorScores.length > 0) {
    lines.push('## Benchmark Competitivo')
    for (const c of ctx.competitorScores) {
      const scores = Object.entries(c.scores)
        .map(([driver, score]) => `${driver}: ${score ?? 'N/A'}`)
        .join(', ')
      lines.push(`- ${c.domain}: ${scores}`)
    }
    lines.push('')
  }

  // MarTech stack
  if (ctx.martechStack.length > 0) {
    lines.push('## Stack MarTech Rilevato')
    const grouped: Record<string, string[]> = {}
    for (const t of ctx.martechStack) {
      if (!grouped[t.category]) grouped[t.category] = []
      grouped[t.category].push(`${t.tool_name} (${Math.round(t.confidence * 100)}%)`)
    }
    for (const [cat, tools] of Object.entries(grouped)) {
      lines.push(`- ${cat}: ${tools.join(', ')}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
