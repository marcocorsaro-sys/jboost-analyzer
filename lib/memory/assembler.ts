// ============================================================
// JBoost — Client Memory: data assembler
// Gathers all client data sources with token budgets
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js'
import type { MemoryAnswer } from '@/lib/types/client'

// ─── Token budgets (approximate chars, ~4 chars per token) ───
const BUDGET_KNOWLEDGE_TOTAL = 20_000    // ~5K tokens
const BUDGET_KNOWLEDGE_PER_FILE = 5_000
const BUDGET_EXEC_SUMMARY = 3_000
const BUDGET_CONVERSATIONS = 8_000
const BUDGET_COMPANY_CONTEXT = 2_000

export interface AssembledData {
  /** Formatted text block ready for the LLM prompt */
  inputText: string
  /** Metadata about what was included */
  sourceVersions: Record<string, unknown>
}

/**
 * Assemble ALL data sources for a client into a structured text block.
 * Applies token budgets to stay within LLM context limits.
 */
export async function assembleClientData(
  clientId: string,
  supabase: SupabaseClient,
  existingAnswers: MemoryAnswer[] = []
): Promise<AssembledData> {
  const lines: string[] = []
  const sourceVersions: Record<string, unknown> = {}

  // ── 1. Client Info (always included) ──────────────────────
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single()

  if (!client) throw new Error('Client not found')

  sourceVersions.client_updated_at = client.updated_at

  lines.push('# DATI CLIENTE')
  lines.push(`Nome: ${client.name}`)
  if (client.domain) lines.push(`Dominio: ${client.domain}`)
  if (client.industry) lines.push(`Settore: ${client.industry}`)
  if (client.website_url) lines.push(`Website: ${client.website_url}`)
  if (client.contact_name) lines.push(`Contatto: ${client.contact_name}`)
  if (client.contact_email) lines.push(`Email: ${client.contact_email}`)
  if (client.contact_phone) lines.push(`Telefono: ${client.contact_phone}`)
  if (client.notes) lines.push(`Note: ${client.notes}`)
  lines.push('')

  // ── 2. Analyses + Driver Results ──────────────────────────
  const { data: analyses } = await supabase
    .from('analyses')
    .select('id, overall_score, completed_at, domain, company_context, status')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(3)

  const analysisIds: string[] = []

  if (analyses && analyses.length > 0) {
    lines.push('# ANALISI SEO')

    for (const analysis of analyses) {
      analysisIds.push(analysis.id)
      const date = analysis.completed_at
        ? new Date(analysis.completed_at).toLocaleDateString('it-IT', {
            day: '2-digit', month: 'long', year: 'numeric',
          })
        : 'N/A'

      lines.push(`## Analisi ${date} — Score: ${analysis.overall_score ?? 'N/A'}/100`)
      lines.push(`Dominio: ${analysis.domain}`)

      // Company context (budget)
      if (analysis.company_context) {
        const cc = analysis.company_context as Record<string, unknown>
        let ccText = ''
        if (cc.company_profile) ccText += `Profilo: ${cc.company_profile}\n`
        if (cc.market_scenario) ccText += `Mercato: ${cc.market_scenario}\n`
        if (cc.main_challenges && Array.isArray(cc.main_challenges)) {
          ccText += `Sfide: ${(cc.main_challenges as string[]).join(', ')}\n`
        }
        if (cc.industry_trends && Array.isArray(cc.industry_trends)) {
          ccText += `Trend: ${(cc.industry_trends as string[]).join(', ')}\n`
        }
        if (ccText) {
          lines.push('### Contesto Aziendale')
          lines.push(truncate(ccText, BUDGET_COMPANY_CONTEXT))
        }
      }

      // Driver results
      const { data: drivers } = await supabase
        .from('driver_results')
        .select('driver_name, score, status, issues, solutions')
        .eq('analysis_id', analysis.id)

      if (drivers && drivers.length > 0) {
        const sorted = [...drivers].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
        for (const d of sorted) {
          const band = d.score !== null
            ? d.score >= 81 ? 'Eccellente' : d.score >= 61 ? 'Buono' : d.score >= 41 ? 'Da migliorare' : 'Critico'
            : 'N/A'
          lines.push(`### ${d.driver_name}: ${d.score ?? 'N/A'}/100 [${band}]`)

          const issues = (d.issues || []) as { title?: string; description?: string }[]
          if (issues.length > 0) {
            lines.push('Problemi:')
            for (const issue of issues.slice(0, 3)) {
              const text = typeof issue === 'string' ? issue : (issue.title || issue.description || '')
              if (text) lines.push(`  - ${text}`)
            }
          }

          const solutions = (d.solutions || []) as { title?: string; description?: string }[]
          if (solutions.length > 0) {
            lines.push('Soluzioni:')
            for (const sol of solutions.slice(0, 2)) {
              const text = typeof sol === 'string' ? sol : (sol.title || sol.description || '')
              if (text) lines.push(`  - ${text}`)
            }
          }
        }
      }
      lines.push('')
    }

    sourceVersions.analyses_ids = analysisIds
    sourceVersions.analyses_latest_at = analyses[0].completed_at
  }

  // ── 3. Competitor Results ─────────────────────────────────
  if (analysisIds.length > 0) {
    const { data: competitors } = await supabase
      .from('competitor_results')
      .select('competitor_domain, scores')
      .eq('analysis_id', analysisIds[0])

    if (competitors && competitors.length > 0) {
      lines.push('# BENCHMARK COMPETITIVO')
      for (const c of competitors) {
        const scores = c.scores as Record<string, number | null>
        const entries = Object.entries(scores)
          .map(([driver, score]) => `${driver}: ${score ?? 'N/A'}`)
          .join(', ')
        lines.push(`- ${c.competitor_domain}: ${entries}`)
      }
      lines.push('')
    }
  }

  // ── 4. MarTech Stack ──────────────────────────────────────
  const { data: martech } = await supabase
    .from('client_martech')
    .select('category, tool_name, confidence')
    .eq('client_id', clientId)

  if (martech && martech.length > 0) {
    lines.push('# STACK MARTECH')
    const grouped: Record<string, string[]> = {}
    for (const t of martech) {
      if (!grouped[t.category]) grouped[t.category] = []
      grouped[t.category].push(`${t.tool_name} (${Math.round(t.confidence * 100)}%)`)
    }
    for (const [cat, tools] of Object.entries(grouped)) {
      lines.push(`- ${cat}: ${tools.join(', ')}`)
    }
    lines.push('')
    sourceVersions.martech_count = martech.length
  }

  // ── 5. Knowledge Files (with budget) ──────────────────────
  const { data: files } = await supabase
    .from('client_files')
    .select('id, file_name, file_type, extracted_text, created_at')
    .eq('client_id', clientId)
    .in('extraction_status', ['completed', 'unsupported'])
    .order('created_at', { ascending: false })

  const fileIds: string[] = []

  if (files && files.length > 0) {
    lines.push('# KNOWLEDGE BASE — DOCUMENTI CARICATI')
    let totalChars = 0

    for (const f of files) {
      if (totalChars >= BUDGET_KNOWLEDGE_TOTAL) {
        lines.push(`[... altri ${files.length - files.indexOf(f)} documenti non inclusi per limiti di spazio]`)
        break
      }

      fileIds.push(f.id)
      const date = new Date(f.created_at).toLocaleDateString('it-IT', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
      lines.push(`## Documento: ${f.file_name} (${date})`)

      if (f.extracted_text) {
        const budgetRemaining = BUDGET_KNOWLEDGE_TOTAL - totalChars
        const maxForFile = Math.min(BUDGET_KNOWLEDGE_PER_FILE, budgetRemaining)
        let text = f.extracted_text
        if (text.length > maxForFile) {
          text = text.substring(0, maxForFile) + '\n[... contenuto troncato]'
        }
        lines.push(text)
        totalChars += text.length
      } else {
        lines.push(`[File ${f.file_type || 'sconosciuto'} — testo non estratto]`)
      }
      lines.push('')
    }

    sourceVersions.files_ids = fileIds
    sourceVersions.files_latest_at = files[0].created_at
  }

  // ── 6. Executive Summary (with budget) ────────────────────
  const { data: summaries } = await supabase
    .from('executive_summaries')
    .select('id, content, generated_at')
    .eq('client_id', clientId)
    .order('generated_at', { ascending: false })
    .limit(1)

  if (summaries && summaries.length > 0 && summaries[0].content) {
    lines.push('# EXECUTIVE SUMMARY PIU\' RECENTE')
    lines.push(truncate(summaries[0].content, BUDGET_EXEC_SUMMARY))
    lines.push('')
    sourceVersions.summaries_ids = [summaries[0].id]
  }

  // ── 7. Conversation Insights (with budget) ────────────────
  const { data: conversations } = await supabase
    .from('conversations')
    .select('id')
    .eq('client_id', clientId)
    .eq('mode', 'contextual')
    .order('updated_at', { ascending: false })
    .limit(5)

  const convIds: string[] = []

  if (conversations && conversations.length > 0) {
    const cIds = conversations.map(c => c.id)

    const { data: messages } = await supabase
      .from('conversation_messages')
      .select('conversation_id, role, content, created_at')
      .in('conversation_id', cIds)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(30)

    if (messages && messages.length > 0) {
      lines.push('# INSIGHT DA CONVERSAZIONI PRECEDENTI')
      let totalConvChars = 0

      for (const m of messages) {
        if (totalConvChars >= BUDGET_CONVERSATIONS) break
        const text = truncate(m.content, 500)
        lines.push(`- [utente]: ${text}`)
        totalConvChars += text.length
        if (!convIds.includes(m.conversation_id)) convIds.push(m.conversation_id)
      }
      lines.push('')
    }

    sourceVersions.conversations_ids = convIds
    if (messages && messages.length > 0) {
      sourceVersions.conversations_latest_at = messages[0].created_at
    }
  }

  // ── 8. Existing Answers (always included, authoritative) ──
  if (existingAnswers.length > 0) {
    lines.push('# RISPOSTE DELL\'UTENTE (AUTORITATIVE)')
    lines.push('Queste risposte sono state fornite direttamente dall\'utente e hanno la massima priorita\'.')
    lines.push('')
    for (const a of existingAnswers) {
      lines.push(`Domanda: ${a.question}`)
      lines.push(`Risposta: ${a.answer}`)
      lines.push(`Data: ${new Date(a.answered_at).toLocaleDateString('it-IT')}`)
      lines.push('')
    }
    sourceVersions.answers_count = existingAnswers.length
  }

  return {
    inputText: lines.join('\n'),
    sourceVersions,
  }
}

// ─── Helpers ────────────────────────────────────────────────

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.substring(0, maxChars) + '\n[... troncato]'
}
