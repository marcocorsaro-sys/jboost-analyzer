// ============================================================
// JBoost — Client Memory: data assembler
// Gathers all client data sources with token budgets.
//
// Phase 5C robustness pass: every source-table fetch is wrapped in its
// own try/catch and degrades gracefully. A missing optional table or an
// RLS rejection on one source no longer kills the entire memory build —
// the memory is just built from whatever sources DID work, and a warning
// is logged. Previously a single missing column or table would throw all
// the way out of the assembler, into refreshClientMemory's catch block,
// and (because of the setRefreshPhase UPDATE no-op bug) leave the user
// staring at "Not initialized" with no clue why.
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js'
import type { MemoryAnswer, MemoryProfile } from '@/lib/types/client'
import { assembleKnowledgeViaRAG } from './knowledge-rag'

// ─── Token budgets (approximate chars, ~4 chars per token) ───
const BUDGET_LEGACY_KNOWLEDGE_TOTAL = 20_000    // ~5K tokens — fallback only
const BUDGET_LEGACY_KNOWLEDGE_PER_FILE = 5_000
const BUDGET_EXEC_SUMMARY = 3_000
const BUDGET_CONVERSATIONS = 8_000
const BUDGET_COMPANY_CONTEXT = 2_000

const log = {
  info: (clientId: string, section: string, msg: string, extra?: Record<string, unknown>) =>
    console.log(`[Assembler ✓] ${clientId} ${section}: ${msg}`, extra ?? ''),
  warn: (clientId: string, section: string, msg: string, extra?: unknown) =>
    console.warn(`[Assembler ⚠] ${clientId} ${section}: ${msg}`, extra ?? ''),
}

export interface AssembledData {
  /** Formatted text block ready for the LLM prompt */
  inputText: string
  /** Metadata about what was included */
  sourceVersions: Record<string, unknown>
}

/**
 * Helper: run a database fetch wrapped in try/catch, swallow errors
 * (logging a warning), and return a fallback. Used to ensure no single
 * missing table or RLS rejection can kill the entire memory build.
 */
async function safeFetch<T>(
  clientId: string,
  section: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    log.warn(clientId, section, `fetch failed (degraded)`, err)
    return fallback
  }
}

/**
 * Assemble ALL data sources for a client into a structured text block.
 * Applies token budgets to stay within LLM context limits. Each section
 * is independent: if one fails (missing table, RLS rejection, schema
 * drift), the others still contribute.
 */
export async function assembleClientData(
  clientId: string,
  supabase: SupabaseClient,
  existingAnswers: MemoryAnswer[] = [],
  existingProfile?: MemoryProfile | null
): Promise<AssembledData> {
  const lines: string[] = []
  const sourceVersions: Record<string, unknown> = {}

  // ── 1. Client Info (REQUIRED) ─────────────────────────────
  // This is the only section that can hard-fail the assembler — if the
  // client itself isn't readable, we have nothing to build a memory FROM.
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    throw new Error(
      `Client ${clientId} not found or not readable. ` +
        `Check that your user has access to this client via client_members ` +
        `(error: ${clientError?.message ?? 'no row returned'}).`
    )
  }

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
  log.info(clientId, 'client', 'loaded')

  // ── 2. Analyses + Driver Results (optional, sectional) ────
  // Two-step query: first try with company_context (the modern schema),
  // fallback to the schema without that column if it's missing in this
  // environment.
  const analyses = await safeFetch(clientId, 'analyses', async () => {
    const withCC = await supabase
      .from('analyses')
      .select('id, overall_score, completed_at, domain, company_context, status')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(3)

    if (!withCC.error) return withCC.data ?? []

    // Retry without the column if it doesn't exist.
    if (withCC.error.message?.toLowerCase().includes('company_context')) {
      log.warn(clientId, 'analyses', 'company_context missing, retrying without it')
      const noCC = await supabase
        .from('analyses')
        .select('id, overall_score, completed_at, domain, status')
        .eq('client_id', clientId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(3)
      if (noCC.error) throw noCC.error
      return (noCC.data ?? []).map(a => ({ ...a, company_context: null }))
    }
    throw withCC.error
  }, [] as Array<{
    id: string
    overall_score: number | null
    completed_at: string | null
    domain: string | null
    company_context: Record<string, unknown> | null
    status: string
  }>)

  const analysisIds: string[] = []

  if (analyses.length > 0) {
    lines.push('# ANALISI SEO')

    for (const analysis of analyses) {
      analysisIds.push(analysis.id)
      const date = analysis.completed_at
        ? new Date(analysis.completed_at).toLocaleDateString('it-IT', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })
        : 'N/A'

      lines.push(`## Analisi ${date} — Score: ${analysis.overall_score ?? 'N/A'}/100`)
      lines.push(`Dominio: ${analysis.domain}`)

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

      // Driver results — optional, fall back to empty
      const drivers = await safeFetch(clientId, 'driver_results', async () => {
        const { data, error } = await supabase
          .from('driver_results')
          .select('driver_name, score, status, issues, solutions')
          .eq('analysis_id', analysis.id)
        if (error) throw error
        return data ?? []
      }, [] as Array<{ driver_name: string; score: number | null; status: string; issues: unknown; solutions: unknown }>)

      if (drivers.length > 0) {
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
    log.info(clientId, 'analyses', `${analyses.length} loaded`)
  } else {
    log.info(clientId, 'analyses', 'none')
  }

  // ── 3. Competitor Results ─────────────────────────────────
  if (analysisIds.length > 0) {
    const competitors = await safeFetch(clientId, 'competitor_results', async () => {
      const { data, error } = await supabase
        .from('competitor_results')
        .select('competitor_domain, scores')
        .eq('analysis_id', analysisIds[0])
      if (error) throw error
      return data ?? []
    }, [] as Array<{ competitor_domain: string; scores: Record<string, number | null> }>)

    if (competitors.length > 0) {
      lines.push('# BENCHMARK COMPETITIVO')
      for (const c of competitors) {
        const scores = c.scores as Record<string, number | null>
        const entries = Object.entries(scores)
          .map(([driver, score]) => `${driver}: ${score ?? 'N/A'}`)
          .join(', ')
        lines.push(`- ${c.competitor_domain}: ${entries}`)
      }
      lines.push('')
      log.info(clientId, 'competitors', `${competitors.length} loaded`)
    }
  }

  // ── 4. MarTech Stack ──────────────────────────────────────
  const martech = await safeFetch(clientId, 'client_martech', async () => {
    const { data, error } = await supabase
      .from('client_martech')
      .select('category, tool_name, confidence')
      .eq('client_id', clientId)
    if (error) throw error
    return data ?? []
  }, [] as Array<{ category: string; tool_name: string; confidence: number }>)

  if (martech.length > 0) {
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
    log.info(clientId, 'martech', `${martech.length} tools`)
  }

  // ── 5. Knowledge — semantic RAG over knowledge_chunks ─────
  let ragWorked = false
  try {
    const ragResult = await assembleKnowledgeViaRAG(clientId, supabase)
    if (ragResult.usedRag && ragResult.text.length > 0) {
      lines.push(ragResult.text)
      lines.push('')
      sourceVersions.knowledge_rag = {
        document_ids: ragResult.documentIds,
        chunk_ids: ragResult.chunkIds,
        chars: ragResult.totalChars,
      }
      ragWorked = true
      log.info(clientId, 'knowledge_rag', `${ragResult.chunkIds.length} chunks from ${ragResult.documentIds.length} docs`)
    } else if (ragResult.error) {
      log.warn(clientId, 'knowledge_rag', `skipped: ${ragResult.error}`)
    }
  } catch (err) {
    log.warn(clientId, 'knowledge_rag', 'RAG threw, falling back to legacy', err)
  }

  // Legacy fallback: client_files.extracted_text
  if (!ragWorked) {
    const files = await safeFetch(clientId, 'client_files', async () => {
      const { data, error } = await supabase
        .from('client_files')
        .select('id, file_name, file_type, extracted_text, created_at')
        .eq('client_id', clientId)
        .in('extraction_status', ['completed', 'unsupported'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    }, [] as Array<{
      id: string
      file_name: string
      file_type: string | null
      extracted_text: string | null
      created_at: string
    }>)

    const fileIds: string[] = []

    if (files.length > 0) {
      lines.push('# KNOWLEDGE BASE — DOCUMENTI CARICATI (legacy)')
      let totalChars = 0

      for (const f of files) {
        if (totalChars >= BUDGET_LEGACY_KNOWLEDGE_TOTAL) {
          lines.push(
            `[... altri ${files.length - files.indexOf(f)} documenti non inclusi per limiti di spazio]`
          )
          break
        }

        fileIds.push(f.id)
        const date = new Date(f.created_at).toLocaleDateString('it-IT', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
        lines.push(`## Documento: ${f.file_name} (${date})`)

        if (f.extracted_text) {
          const budgetRemaining = BUDGET_LEGACY_KNOWLEDGE_TOTAL - totalChars
          const maxForFile = Math.min(
            BUDGET_LEGACY_KNOWLEDGE_PER_FILE,
            budgetRemaining
          )
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

      sourceVersions.legacy_files_ids = fileIds
      sourceVersions.legacy_files_latest_at = files[0].created_at
      log.info(clientId, 'client_files', `${files.length} legacy files`)
    }
  }

  // ── 6. Executive Summary ──────────────────────────────────
  const summaries = await safeFetch(clientId, 'executive_summaries', async () => {
    const { data, error } = await supabase
      .from('executive_summaries')
      .select('id, content, generated_at')
      .eq('client_id', clientId)
      .order('generated_at', { ascending: false })
      .limit(1)
    if (error) throw error
    return data ?? []
  }, [] as Array<{ id: string; content: string | null; generated_at: string }>)

  if (summaries.length > 0 && summaries[0].content) {
    lines.push('# EXECUTIVE SUMMARY PIU\' RECENTE')
    lines.push(truncate(summaries[0].content, BUDGET_EXEC_SUMMARY))
    lines.push('')
    sourceVersions.summaries_ids = [summaries[0].id]
    log.info(clientId, 'executive_summaries', '1 loaded')
  }

  // ── 7. Conversation Insights ──────────────────────────────
  const conversations = await safeFetch(clientId, 'conversations', async () => {
    const { data, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('client_id', clientId)
      .eq('mode', 'contextual')
      .order('updated_at', { ascending: false })
      .limit(5)
    if (error) throw error
    return data ?? []
  }, [] as Array<{ id: string }>)

  const convIds: string[] = []

  if (conversations.length > 0) {
    const cIds = conversations.map(c => c.id)

    const messages = await safeFetch(clientId, 'conversation_messages', async () => {
      const { data, error } = await supabase
        .from('conversation_messages')
        .select('conversation_id, role, content, created_at')
        .in('conversation_id', cIds)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data ?? []
    }, [] as Array<{ conversation_id: string; role: string; content: string; created_at: string }>)

    if (messages.length > 0) {
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

      sourceVersions.conversations_ids = convIds
      sourceVersions.conversations_latest_at = messages[0].created_at
      log.info(clientId, 'conversations', `${messages.length} messages from ${convIds.length} convs`)
    }
  }

  // ── 8. Onboarding seed (Phase 5D, AUTHORITATIVE) ──────────
  // The structured onboarding wizard populates `profile.brand`, `.markets`,
  // `.stakeholders`, `.access`, `.seo_foundation`, `.geo`, `.content_strategy`,
  // `.goals_kpis`, `.compliance` directly on client_memory.profile. Re-feed
  // those sections to the synthesizer as an authoritative user_answer-level
  // source so they survive each full refresh and drive gap detection.
  if (existingProfile) {
    const seed = serializeOnboardingSeed(existingProfile)
    if (seed) {
      lines.push('# ONBOARDING PROFILE (AUTHORITATIVE SEED — user_answer level)')
      lines.push('Questi dati provengono dal wizard di onboarding compilato dal consulente.')
      lines.push('Hanno priorita\' massima e devono essere preservati nel profilo di output.')
      lines.push('')
      lines.push(seed)
      lines.push('')
      const ob = existingProfile.onboarding
      sourceVersions.onboarding = {
        version: ob?.version ?? 0,
        status: ob?.status ?? 'not_started',
        completed_sections: ob?.completed_sections ?? [],
        completed_at: ob?.completed_at ?? null,
      }
      log.info(clientId, 'onboarding', `seed included (status=${ob?.status ?? 'n/a'})`)
    }
  }

  // ── 9. Existing Answers (always included, authoritative) ──
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

/**
 * Serialize the Phase 5D onboarding seed sections of MemoryProfile into
 * a human-readable block for the LLM. Returns an empty string if no
 * onboarding data is present so the caller can skip the whole section.
 */
function serializeOnboardingSeed(profile: MemoryProfile): string {
  const parts: string[] = []

  const pushList = (label: string, arr?: string[] | null) => {
    if (arr && arr.length > 0) parts.push(`- ${label}: ${arr.join(', ')}`)
  }
  const pushStr = (label: string, v?: string | null) => {
    if (v && v.trim()) parts.push(`- ${label}: ${v.trim()}`)
  }
  const pushBool = (label: string, v?: boolean) => {
    if (typeof v === 'boolean') parts.push(`- ${label}: ${v ? 'si' : 'no'}`)
  }

  if (profile.brand) {
    const b = profile.brand
    parts.push('## BRAND & AZIENDA')
    pushStr('Legal name', b.legal_name)
    pushStr('Tagline', b.tagline)
    pushStr('UVP', b.uvp)
    pushStr('Mission', b.mission)
    pushList('Values', b.values)
    pushStr('Voice', b.voice)
    pushStr('Tone', b.tone)
    pushList('Do not say', b.do_not_say)
    parts.push('')
  }

  if (profile.markets) {
    const m = profile.markets
    parts.push('## MERCATI & TARGET')
    pushList('Primary regions', m.primary_regions)
    pushList('Secondary regions', m.secondary_regions)
    pushList('Languages', m.languages)
    pushStr('B2B/B2C', m.b2b_b2c)
    pushStr('ICP', m.icp)
    if (m.personas && m.personas.length > 0) {
      parts.push('- Personas:')
      for (const p of m.personas) {
        const pains = p.pain_points?.length ? ` — pain: ${p.pain_points.join(', ')}` : ''
        parts.push(`  • ${p.name}: ${p.description}${pains}`)
      }
    }
    parts.push('')
  }

  if (profile.stakeholders && profile.stakeholders.length > 0) {
    parts.push('## STAKEHOLDERS')
    for (const s of profile.stakeholders) {
      const dm = s.is_decision_maker ? ' [DECISION MAKER]' : ''
      const dept = s.department ? ` (${s.department})` : ''
      const email = s.email ? ` <${s.email}>` : ''
      const approval = s.approval_scope ? ` — approval: ${s.approval_scope}` : ''
      parts.push(`- ${s.name}, ${s.role}${dept}${email}${dm}${approval}`)
    }
    parts.push('')
  }

  if (profile.access) {
    const a = profile.access
    parts.push('## ACCESSI & ASSET')
    if (a.cms?.platform) parts.push(`- CMS: ${a.cms.platform}`)
    if (a.analytics?.ga4_property_id) parts.push(`- GA4: ${a.analytics.ga4_property_id}`)
    pushBool('GSC verified', a.analytics?.gsc_verified)
    pushBool('SEMrush', a.seo_tools?.semrush)
    pushBool('Ahrefs', a.seo_tools?.ahrefs)
    pushStr('SEO tools notes', a.seo_tools?.notes)
    pushList('Asset repos', a.asset_repos)
    pushStr('Brand guidelines', a.brand_guidelines_url)
    parts.push('')
  }

  if (profile.seo_foundation) {
    const s = profile.seo_foundation
    parts.push('## SEO FOUNDATION')
    pushStr('Maturity level', s.maturity_level)
    pushList('Priority keywords', s.priority_keywords)
    pushList('Priority topics', s.priority_topics)
    pushList('Priority pages', s.priority_pages)
    pushList('Current issues', s.current_issues)
    pushStr('Historical context', s.historical_context)
    parts.push('')
  }

  if (profile.geo) {
    const g = profile.geo
    parts.push('## GEO — GENERATIVE ENGINE OPTIMIZATION')
    pushList('Target engines', g.target_engines)
    pushBool('Wikipedia entity', g.entity_status?.wikipedia)
    pushBool('Knowledge panel', g.entity_status?.knowledge_panel)
    pushBool('llms.txt', g.entity_status?.llms_txt)
    pushStr('Schema maturity', g.schema_maturity)
    pushList('E-E-A-T signals', g.eeat_signals)
    if (g.author_entities && g.author_entities.length > 0) {
      parts.push(`- Author entities: ${g.author_entities.map(a => a.credentials ? `${a.name} (${a.credentials})` : a.name).join('; ')}`)
    }
    pushStr('Current mentions', g.current_mentions)
    pushList('GEO goals', g.geo_goals)
    parts.push('')
  }

  if (profile.content_strategy) {
    const c = profile.content_strategy
    parts.push('## CONTENT STRATEGY')
    pushList('Pillars', c.pillars)
    pushList('Topic clusters', c.topic_clusters)
    pushStr('Editorial calendar', c.editorial_calendar_url)
    pushList('Formats', c.formats)
    pushStr('Publishing cadence', c.publishing_cadence)
    pushBool('Multilingual', c.multilingual)
    pushList('Distribution channels', c.distribution_channels)
    pushStr('Inventory size', c.content_inventory_size)
    parts.push('')
  }

  if (profile.goals_kpis) {
    const g = profile.goals_kpis
    parts.push('## OBIETTIVI & KPI')
    pushList('Short term (90d)', g.short_term)
    pushList('Medium term (6m)', g.medium_term)
    pushList('Long term (12m+)', g.long_term)
    pushStr('Primary KPI', g.primary_kpi)
    pushStr('Success criteria', g.success_criteria)
    if (g.baselines && Object.keys(g.baselines).length > 0) {
      parts.push('- Baselines:')
      for (const [k, v] of Object.entries(g.baselines)) {
        parts.push(`  • ${k}: ${v}`)
      }
    }
    parts.push('')
  }

  if (profile.compliance) {
    const c = profile.compliance
    parts.push('## COMPLIANCE & VINCOLI')
    pushList('Regulations', c.regulations)
    pushStr('Approval workflow', c.approval_workflow)
    pushList('Embargo topics', c.embargo_topics)
    pushBool('Legal review required', c.legal_review_required)
    pushStr('Trademark notes', c.trademark_notes)
    parts.push('')
  }

  if (profile.onboarding) {
    const o = profile.onboarding
    parts.push('## ONBOARDING STATE')
    parts.push(`- Status: ${o.status}`)
    parts.push(`- Version: ${o.version}`)
    if (o.completed_sections.length > 0) {
      parts.push(`- Completed sections: ${o.completed_sections.join(', ')}`)
    }
    if (o.skipped_fields.length > 0) {
      parts.push(`- Skipped fields (should drive gap questions): ${o.skipped_fields.join(', ')}`)
    }
    parts.push('')
  }

  return parts.join('\n').trim()
}
