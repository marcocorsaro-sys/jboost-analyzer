/**
 * V4 — Output Preview export: the ONE report model shared by the three
 * generators (PPTX / Word / interactive HTML artifact — README 01 §8: no PDF
 * by default).
 *
 * WHY a shared pure model: the three formats must tell the same story — the
 * 5 golden-standard sections per driver (README 01 §6), the executive
 * summary, the threshold transparency ("the number never without its
 * criterion") — and the only way to guarantee that is to compute the story
 * ONCE, from the same driver_runs rows the results screen consolidates, and
 * let each generator be a dumb renderer. This module is pure (no DB, no
 * next, no LLM): it takes row slices and returns strings and numbers, so it
 * is testable with plain fixtures.
 *
 * Null discipline (Bibbia sheet 8): a driver not measured or in error is
 * reported AS SUCH, with the reason — never rendered as 0.
 *
 * Language: it/en from analyses.output_language. The model carries the
 * localized labels so the generators stay language-agnostic.
 */

import { getV4Driver } from '@/lib/scoring/registry'
import { DISCO_TIERS } from '@/lib/scoring/registry'

// ---------------------------------------------------------------------------
// Input slices (superset-safe vs the DB rows / API shapes)
// ---------------------------------------------------------------------------

export type ReportLang = 'it' | 'en'

export interface ExportAnalysisRow {
  id: string
  domain: string | null
  brand_name: string | null
  industry_preset: string | null
  output_language: string | null
  ref_date: string | null
  /** analyses.v4_executive_summary (LlmInsightRecord-shaped JSON, or null). */
  v4_executive_summary: unknown
}

export interface ExportSite {
  site_ref: string
  domain: string
  name: string
  is_client: boolean
}

export interface ExportRunRow {
  driver_key: string
  enabled: boolean
  status: string
  raw_value: number | null
  score_absolute: number | null
  score_relative: number | null
  comment_absolute: string | null
  comment_relative: string | null
  tier_used: string | null
  error: string | null
  raw_payload: Record<string, unknown> | null
  /** driver_runs.llm_insight (LlmInsightRecord-shaped JSON, or null). */
  llm_insight: unknown
}

// ---------------------------------------------------------------------------
// Output model
// ---------------------------------------------------------------------------

export type NarrativeStatus = 'done' | 'not_generated' | 'error'
export type DriverReportStatus = 'done' | 'error' | 'pending' | 'needs_decision'

export interface ReportScoreEntry {
  name: string
  domain: string
  isClient: boolean
  scoreRelative: number | null
  scoreAbsolute: number | null
  raw: number | null
  rank: number | null
}

/** The golden-standard issue table row: Area · Problema · Impatto · Soluzione · Priorità. */
export interface ReportIssueRow {
  area: string
  problem: string
  impact: string
  solution: string
  priority: string
}

export interface ReportSolutionRow {
  title: string
  action: string
  priority: string
}

export interface ReportTable {
  title: string
  columns: string[]
  rows: string[][]
}

export interface ReportDriverSection {
  key: string
  label: string
  family: 'business' | 'development'
  status: DriverReportStatus
  /** Localized status explanation for non-done drivers (incl. error reason). */
  statusNote: string | null
  /** Section 1 — client first, then competitors. Empty when not measured. */
  scores: ReportScoreEntry[]
  hasAbsoluteView: boolean
  /**
   * Threshold transparency (README 01 §6): the explicit criterion behind the
   * number, e.g. "keyword non-brand in top 10 con volume >= 1000; tier: strict".
   */
  criteria: string | null
  /** Section 2 — 3-4 sober bullets from the LLM insight (analyst comment as fallback). */
  summaryStatus: NarrativeStatus
  summaryBullets: string[]
  /** Section 3 — key scalars + evidence tables (client site). */
  dataRows: Array<{ label: string; value: string }>
  dataTables: ReportTable[]
  /** Sections 4/5 — capped at 5 (README 01 §6: 3-5). */
  issuesStatus: NarrativeStatus
  issuesError: string | null
  issues: ReportIssueRow[]
  solutions: ReportSolutionRow[]
  /** Business drivers: strategic solutions live in the Executive Summary. */
  solutionsNote: string | null
}

export interface ReportPriority {
  title: string
  rationale: string
  drivers: string[]
  horizonMonths: number
  impact: string
}

export interface ReportSummary {
  status: NarrativeStatus
  error: string | null
  headline: string | null
  scorecard: string | null
  correlations: Array<{ title: string; explanation: string; drivers: string[] }>
  priorities: ReportPriority[]
  alerts: string[]
}

export interface ReportOverviewRow {
  key: string
  label: string
  family: 'business' | 'development'
  status: DriverReportStatus
  statusLabel: string
  scoreRelative: number | null
  scoreAbsolute: number | null
  hasAbsoluteView: boolean
  rank: number | null
}

export interface ReportModel {
  lang: ReportLang
  labels: ReportLabels
  cover: {
    title: string
    client: string
    domain: string
    industry: string | null
    refDate: string | null
    generatedAt: string
    competitors: string[]
  }
  overview: { rows: ReportOverviewRow[] }
  drivers: ReportDriverSection[]
  summary: ReportSummary
}

// ---------------------------------------------------------------------------
// Localized labels — the generators read these, never a locale switch.
// ---------------------------------------------------------------------------

const LABELS_EN = {
  coverTitle: 'SEO & GEO Audit',
  coverSubtitle: 'Driver Intelligence Platform — audit report',
  preparedFor: 'Prepared for',
  domain: 'Domain',
  industry: 'Industry',
  refDate: 'Reference date',
  generatedAt: 'Generated on',
  competitorSet: 'Competitor set',
  noCompetitors: 'no competitors configured',
  toc: 'Contents',
  overviewTitle: 'Score overview',
  overviewNote:
    'Scores are leader-relative (set leader = 100). The Absolute column shows the intrinsic 0-100 where the driver has one.',
  colDriver: 'Driver',
  colFamily: 'Family',
  colRelative: 'Relative score',
  colAbsolute: 'Absolute score',
  colRank: 'Rank',
  colStatus: 'Status',
  familyBusiness: 'Business',
  familyDevelopment: 'Development',
  secScore: 'Score',
  secSummary: 'Summary',
  secData: 'Data & metrics',
  secIssues: 'Issues',
  secSolutions: 'Solutions',
  colArea: 'Area',
  colProblem: 'Issue',
  colImpact: 'Impact',
  colSolution: 'Solution',
  colPriority: 'Priority',
  colSite: 'Site',
  colRaw: 'Raw value',
  client: 'Client',
  leader: 'leader',
  statusDone: 'measured',
  statusError: 'error',
  statusPending: 'not measured (still running)',
  statusNeedsDecision: 'paused (analyst decision required)',
  notMeasured: 'Driver not measured',
  driverErrorPrefix: 'Driver in error',
  pendingNote: 'This driver had not completed when the report was generated. No score is shown: an unfinished measurement is not a 0.',
  needsDecisionNote: 'This driver is paused on an open analyst decision. No score is shown until the decision is taken.',
  notGenerated: 'Not generated: run the AI insights to fill this section.',
  summaryErrorPrefix: 'Insight generation failed',
  noIssues: 'No issues extracted for this driver.',
  businessSolutionsNote:
    'Business driver: strategic solutions are consolidated in the Executive Summary (priority roadmap).',
  execTitle: 'Executive Summary',
  execNotGenerated: 'Executive Summary not generated: run the AI insights to produce it.',
  scorecard: 'Scorecard overview',
  correlations: 'Key correlations',
  priorities: 'Strategic priorities',
  alerts: 'Critical alerts',
  months: 'months',
  impact: 'impact',
  driversInvolved: 'drivers',
  viewRelative: 'Relative',
  viewAbsolute: 'Absolute',
  relativeOnlyNote: 'leader-relative only',
  awarenessCriteria:
    'Basis: branded keywords of the domain in the top 100 (domain-grounded), sum of monthly search volume',
  discoCriteria: 'Basis: non-brand keywords in top {pos} with volume >= {vol}; tier: {tier}',
  brandTerms: 'brand terms',
  evidenceMore: 'more rows omitted',
  noValue: 'no value',
} as const

const LABELS_IT: Record<keyof typeof LABELS_EN, string> = {
  coverTitle: 'Audit SEO & GEO',
  coverSubtitle: 'Driver Intelligence Platform — report di audit',
  preparedFor: 'Preparato per',
  domain: 'Dominio',
  industry: 'Settore',
  refDate: 'Data di riferimento',
  generatedAt: 'Generato il',
  competitorSet: 'Set competitor',
  noCompetitors: 'nessun competitor configurato',
  toc: 'Indice',
  overviewTitle: 'Panoramica degli score',
  overviewNote:
    'Gli score sono leader-relative (leader del set = 100). La colonna Assoluto mostra lo 0-100 intrinseco dove il driver lo prevede.',
  colDriver: 'Driver',
  colFamily: 'Famiglia',
  colRelative: 'Score relativo',
  colAbsolute: 'Score assoluto',
  colRank: 'Posizione',
  colStatus: 'Stato',
  familyBusiness: 'Business',
  familyDevelopment: 'Development',
  secScore: 'Score',
  secSummary: 'Sintesi',
  secData: 'Dati e metriche',
  secIssues: 'Issues',
  secSolutions: 'Soluzioni',
  colArea: 'Area',
  colProblem: 'Problema',
  colImpact: 'Impatto',
  colSolution: 'Soluzione',
  colPriority: 'Priorità',
  colSite: 'Sito',
  colRaw: 'Valore raw',
  client: 'Cliente',
  leader: 'leader',
  statusDone: 'misurato',
  statusError: 'errore',
  statusPending: 'non misurato (ancora in esecuzione)',
  statusNeedsDecision: 'in pausa (decisione analista richiesta)',
  notMeasured: 'Driver non misurato',
  driverErrorPrefix: 'Driver in errore',
  pendingNote: 'Questo driver non era completato al momento della generazione. Nessuno score mostrato: una misura non finita non è uno 0.',
  needsDecisionNote: 'Questo driver è in pausa su una decisione analista aperta. Nessuno score finché la decisione non viene presa.',
  notGenerated: 'Non generato: lancia gli insight AI per riempire questa sezione.',
  summaryErrorPrefix: 'Generazione insight fallita',
  noIssues: 'Nessuna issue estratta per questo driver.',
  businessSolutionsNote:
    'Driver Business: le soluzioni strategiche sono consolidate nell’Executive Summary (roadmap delle priorità).',
  execTitle: 'Executive Summary',
  execNotGenerated: 'Executive Summary non generato: lancia gli insight AI per produrlo.',
  scorecard: 'Panoramica scorecard',
  correlations: 'Correlazioni chiave',
  priorities: 'Priorità strategiche',
  alerts: 'Alert critici',
  months: 'mesi',
  impact: 'impatto',
  driversInvolved: 'driver',
  viewRelative: 'Relativo',
  viewAbsolute: 'Assoluto',
  relativeOnlyNote: 'solo leader-relative',
  awarenessCriteria:
    'Base di conteggio: keyword branded del dominio in top 100 (domain-grounded), somma del volume di ricerca mensile',
  discoCriteria: 'Base di conteggio: keyword non-brand in top {pos} con volume >= {vol}; tier: {tier}',
  brandTerms: 'termini brand',
  evidenceMore: 'altre righe omesse',
  noValue: 'nessun valore',
}

export type ReportLabels = Record<keyof typeof LABELS_EN, string>

// ---------------------------------------------------------------------------
// Caps — README 01 §6: issues 3-5, solutions 3-5; tables stay readable.
// ---------------------------------------------------------------------------

const MAX_ISSUES = 5
const MAX_SOLUTIONS = 5
const MAX_SUMMARY_BULLETS = 4
const MAX_DATA_ROWS = 12
const MAX_DATA_TABLES = 4
const MAX_TABLE_ROWS = 8
const MAX_TABLE_COLS = 6

// ---------------------------------------------------------------------------
// Insight record parsing (defensive: it is stored JSON, not a typed column)
// ---------------------------------------------------------------------------

interface ParsedInsight {
  status: NarrativeStatus
  error: string | null
  output: Record<string, unknown> | null
}

function parseInsightRecord(record: unknown): ParsedInsight {
  if (record === null || record === undefined || typeof record !== 'object') {
    return { status: 'not_generated', error: null, output: null }
  }
  const r = record as { status?: unknown; output?: unknown; error?: unknown }
  if (r.status === 'done' && r.output !== null && typeof r.output === 'object') {
    return { status: 'done', error: null, output: r.output as Record<string, unknown> }
  }
  if (r.status === 'error') {
    return { status: 'error', error: typeof r.error === 'string' ? r.error : 'unknown', output: null }
  }
  return { status: 'not_generated', error: null, output: null }
}

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  )
}

/** 3-4 bullets out of a 3-5 sentence comment: one sentence per bullet. */
export function toBullets(text: string, max: number = MAX_SUMMARY_BULLETS): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (sentences.length === 0) return []
  if (sentences.length <= max) return sentences
  // Keep the first max-1 sentences and merge the tail into the last bullet:
  // dropping the closing sentences would drop the conclusion.
  return [...sentences.slice(0, max - 1), sentences.slice(max - 1).join(' ')]
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function formatValue(v: unknown, labels: ReportLabels): string {
  if (v === null || v === undefined) return labels.noValue
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  if (typeof v === 'object') return clip(JSON.stringify(v), 120)
  return String(v)
}

// ---------------------------------------------------------------------------
// Evidence → data section (generic, same philosophy as the on-screen
// EvidenceBlock: scalars as rows, arrays of objects as tables)
// ---------------------------------------------------------------------------

interface RunSiteEntry {
  site_ref?: string
  domain?: string
  raw?: number | null
  score_absolute?: number | null
  score_relative?: number | null
  rank?: number | null
  evidence?: Record<string, unknown>
}

function readRunSites(run: ExportRunRow): RunSiteEntry[] {
  const sites = (run.raw_payload as { sites?: unknown } | null)?.sites
  return Array.isArray(sites) ? (sites as RunSiteEntry[]) : []
}

function evidenceToData(
  evidence: Record<string, unknown>,
  labels: ReportLabels,
): { rows: Array<{ label: string; value: string }>; tables: ReportTable[] } {
  const rows: Array<{ label: string; value: string }> = []
  const tables: ReportTable[] = []

  for (const [key, value] of Object.entries(evidence)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      if (rows.length < MAX_DATA_ROWS) rows.push({ label: key, value: formatValue(value, labels) })
      continue
    }
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      const first = value[0]
      if (first === null || typeof first !== 'object') {
        if (rows.length < MAX_DATA_ROWS) {
          rows.push({
            label: key,
            value: value.slice(0, 10).map((x) => formatValue(x, labels)).join(', '),
          })
        }
        continue
      }
      if (tables.length >= MAX_DATA_TABLES) continue
      const objRows = value.slice(0, MAX_TABLE_ROWS) as Array<Record<string, unknown>>
      const columns = [...new Set(objRows.flatMap((r) => Object.keys(r)))].slice(0, MAX_TABLE_COLS)
      tables.push({
        title: value.length > MAX_TABLE_ROWS ? `${key} (+${value.length - MAX_TABLE_ROWS} ${labels.evidenceMore})` : key,
        columns,
        rows: objRows.map((r) => columns.map((c) => formatValue(r[c], labels))),
      })
      continue
    }
    // Plain object: flatten to one row.
    if (rows.length < MAX_DATA_ROWS) rows.push({ label: key, value: formatValue(value, labels) })
  }

  return { rows, tables }
}

// ---------------------------------------------------------------------------
// Threshold transparency (README 01 §6) — Discoverability and Awareness
// ---------------------------------------------------------------------------

function criteriaFor(run: ExportRunRow, clientEvidence: Record<string, unknown>, labels: ReportLabels): string | null {
  if (run.driver_key === 'discoverability') {
    const tierKey = str((clientEvidence as { tier?: unknown }).tier) ?? run.tier_used ?? 'strict'
    const evRule = (clientEvidence as { tier_rule?: { position_max?: number; volume_min?: number } }).tier_rule
    const rule =
      evRule && typeof evRule.position_max === 'number' && typeof evRule.volume_min === 'number'
        ? { pos: evRule.position_max, vol: evRule.volume_min }
        : (() => {
            const tier = DISCO_TIERS.find((x) => x.key === tierKey)
            return tier ? { pos: tier.pos, vol: tier.vol } : { pos: 10, vol: 1000 }
          })()
    return fillTemplate(labels.discoCriteria, { pos: rule.pos, vol: rule.vol, tier: tierKey })
  }
  if (run.driver_key === 'awareness') {
    const terms = (clientEvidence as { brand_terms?: unknown }).brand_terms
    const suffix =
      Array.isArray(terms) && terms.length > 0 ? ` (${labels.brandTerms}: ${terms.map(String).join(', ')})` : ''
    return `${labels.awarenessCriteria}${suffix}`
  }
  return null
}

// ---------------------------------------------------------------------------
// Issues / solutions from the sheet-15 insight schemas
// ---------------------------------------------------------------------------

interface DevItem {
  titolo?: unknown
  spiegazione?: unknown
  soluzione_proposta?: unknown
  priorita?: unknown
}
interface BizItem {
  titolo?: unknown
  spiegazione?: unknown
  rilevanza_strategica?: unknown
}

function issuesFrom(
  output: Record<string, unknown>,
  family: 'business' | 'development',
  driverLabel: string,
): { issues: ReportIssueRow[]; solutions: ReportSolutionRow[] } {
  if (family === 'business') {
    const list = Array.isArray(output.insights) ? (output.insights as BizItem[]) : []
    return {
      issues: list.slice(0, MAX_ISSUES).map((x) => ({
        area: driverLabel,
        problem: str(x.titolo) ?? '—',
        impact: clip(str(x.spiegazione) ?? '—', 400),
        solution: '—',
        priority: str(x.rilevanza_strategica) ?? '—',
      })),
      // Sheet 15: business insights carry no per-item solution; the
      // strategic solutions live in the Executive Summary roadmap.
      solutions: [],
    }
  }
  const list = Array.isArray(output.items) ? (output.items as DevItem[]) : []
  return {
    issues: list.slice(0, MAX_ISSUES).map((x) => ({
      area: driverLabel,
      problem: str(x.titolo) ?? '—',
      impact: clip(str(x.spiegazione) ?? '—', 400),
      solution: clip(str(x.soluzione_proposta) ?? '—', 400),
      priority: str(x.priorita) ?? '—',
    })),
    solutions: list
      .filter((x) => str(x.soluzione_proposta) !== null)
      .slice(0, MAX_SOLUTIONS)
      .map((x) => ({
        title: str(x.titolo) ?? '—',
        action: str(x.soluzione_proposta) as string,
        priority: str(x.priorita) ?? '—',
      })),
  }
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function buildReportModel(
  analysis: ExportAnalysisRow,
  sites: ExportSite[],
  runs: ExportRunRow[],
  now: Date = new Date(),
): ReportModel {
  const lang: ReportLang = analysis.output_language === 'en' ? 'en' : 'it'
  const labels: ReportLabels = lang === 'en' ? LABELS_EN : LABELS_IT

  const client = sites.find((s) => s.is_client)
  const competitors = sites.filter((s) => !s.is_client)

  const statusLabelOf = (s: DriverReportStatus): string =>
    s === 'done'
      ? labels.statusDone
      : s === 'error'
        ? labels.statusError
        : s === 'needs_decision'
          ? labels.statusNeedsDecision
          : labels.statusPending

  const enabled = runs
    .filter((r) => r.enabled)
    .sort((a, b) => (getV4Driver(a.driver_key)?.uiOrder ?? 99) - (getV4Driver(b.driver_key)?.uiOrder ?? 99))

  const driverSections: ReportDriverSection[] = enabled.map((run) => {
    const def = getV4Driver(run.driver_key)
    const label = def?.label ?? run.driver_key
    const family = def?.family ?? 'development'
    const status: DriverReportStatus =
      run.status === 'done'
        ? 'done'
        : run.status === 'error'
          ? 'error'
          : run.status === 'needs_decision'
            ? 'needs_decision'
            : 'pending'

    // Non-done drivers: report the state and the reason. No numbers, ever.
    if (status !== 'done') {
      const statusNote =
        status === 'error'
          ? `${labels.driverErrorPrefix}: ${run.error ?? '—'}`
          : status === 'needs_decision'
            ? labels.needsDecisionNote
            : labels.pendingNote
      return {
        key: run.driver_key,
        label,
        family,
        status,
        statusNote,
        scores: [],
        hasAbsoluteView: def?.hasAbsoluteView ?? false,
        criteria: null,
        summaryStatus: 'not_generated',
        summaryBullets: [],
        dataRows: [],
        dataTables: [],
        issuesStatus: 'not_generated',
        issuesError: null,
        issues: [],
        solutions: [],
        solutionsNote: null,
      }
    }

    const runSites = readRunSites(run)
    const siteName = (ref: string | undefined, domain: string | undefined): string =>
      sites.find((s) => s.site_ref === ref)?.name ?? domain ?? ref ?? '—'

    const clientEntry = runSites.find((s) => s.site_ref === 'client')
    const scores: ReportScoreEntry[] = [
      {
        name: client?.name ?? labels.client,
        domain: client?.domain ?? analysis.domain ?? '—',
        isClient: true,
        scoreRelative: run.score_relative,
        scoreAbsolute: run.score_absolute,
        raw: run.raw_value,
        rank: typeof clientEntry?.rank === 'number' ? clientEntry.rank : null,
      },
      ...runSites
        .filter((s) => s.site_ref !== 'client')
        .map((s) => ({
          name: siteName(s.site_ref, s.domain),
          domain: s.domain ?? '—',
          isClient: false,
          scoreRelative: typeof s.score_relative === 'number' ? s.score_relative : null,
          scoreAbsolute: typeof s.score_absolute === 'number' ? s.score_absolute : null,
          raw: typeof s.raw === 'number' ? s.raw : null,
          rank: typeof s.rank === 'number' ? s.rank : null,
        })),
    ]

    const clientEvidence = (clientEntry?.evidence ?? {}) as Record<string, unknown>
    const { rows: dataRows, tables: dataTables } = evidenceToData(clientEvidence, labels)
    const criteria = criteriaFor(run, clientEvidence, labels)

    const insight = parseInsightRecord(run.llm_insight)
    let summaryStatus: NarrativeStatus
    let summaryBullets: string[] = []
    if (insight.status === 'done' && insight.output) {
      const comment =
        str(insight.output.commento_relative) ?? str(insight.output.commento_absolute)
      summaryBullets = comment ? toBullets(comment) : []
      summaryStatus = summaryBullets.length > 0 ? 'done' : 'not_generated'
    } else if (insight.status === 'error') {
      summaryStatus = 'error'
    } else if (run.comment_relative || run.comment_absolute) {
      // Analyst-written comment survives even without LLM insights.
      summaryBullets = toBullets((run.comment_relative ?? run.comment_absolute) as string)
      summaryStatus = 'done'
    } else {
      summaryStatus = 'not_generated'
    }

    const { issues, solutions } =
      insight.status === 'done' && insight.output
        ? issuesFrom(insight.output, family, label)
        : { issues: [], solutions: [] }

    return {
      key: run.driver_key,
      label,
      family,
      status,
      statusNote: null,
      scores,
      hasAbsoluteView: def?.hasAbsoluteView ?? false,
      criteria,
      summaryStatus,
      summaryBullets,
      dataRows,
      dataTables,
      issuesStatus: insight.status,
      issuesError: insight.error,
      issues,
      solutions,
      solutionsNote: family === 'business' && insight.status === 'done' ? labels.businessSolutionsNote : null,
    }
  })

  // Overview table rows mirror the driver sections (same status discipline).
  const overviewRows: ReportOverviewRow[] = driverSections.map((d) => ({
    key: d.key,
    label: d.label,
    family: d.family,
    status: d.status,
    statusLabel: statusLabelOf(d.status),
    scoreRelative: d.status === 'done' ? (d.scores[0]?.scoreRelative ?? null) : null,
    scoreAbsolute: d.status === 'done' ? (d.scores[0]?.scoreAbsolute ?? null) : null,
    hasAbsoluteView: d.hasAbsoluteView,
    rank: d.status === 'done' ? (d.scores[0]?.rank ?? null) : null,
  }))

  // Executive summary (sheet 16 C record on analyses.v4_executive_summary).
  const exec = parseInsightRecord(analysis.v4_executive_summary)
  const out = exec.output ?? {}
  const summary: ReportSummary = {
    status: exec.status,
    error: exec.error,
    headline: str((out as { headline_dominante?: unknown }).headline_dominante),
    scorecard: str((out as { scorecard_overview?: unknown }).scorecard_overview),
    correlations: (Array.isArray((out as { correlazioni_chiave?: unknown }).correlazioni_chiave)
      ? ((out as { correlazioni_chiave: unknown[] }).correlazioni_chiave as Array<Record<string, unknown>>)
      : []
    ).map((c) => ({
      title: str(c.titolo) ?? '—',
      explanation: str(c.spiegazione) ?? '—',
      drivers: Array.isArray(c.driver_coinvolti) ? c.driver_coinvolti.map(String) : [],
    })),
    priorities: (Array.isArray((out as { priorita_strategiche?: unknown }).priorita_strategiche)
      ? ((out as { priorita_strategiche: unknown[] }).priorita_strategiche as Array<Record<string, unknown>>)
      : []
    ).map((p) => ({
      title: str(p.titolo) ?? '—',
      rationale: str(p.razionale) ?? '—',
      drivers: Array.isArray(p.driver_impattati) ? p.driver_impattati.map(String) : [],
      horizonMonths: typeof p.orizzonte_temporale_mesi === 'number' ? p.orizzonte_temporale_mesi : 12,
      impact: str(p.impatto_atteso) ?? '—',
    })),
    alerts: Array.isArray((out as { alert_critici?: unknown }).alert_critici)
      ? ((out as { alert_critici: unknown[] }).alert_critici as unknown[]).map(String)
      : [],
  }

  const dateFmt = (iso: string): string => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  return {
    lang,
    labels,
    cover: {
      title: labels.coverTitle,
      client: analysis.brand_name ?? client?.name ?? analysis.domain ?? '—',
      domain: analysis.domain ?? client?.domain ?? '—',
      industry: analysis.industry_preset,
      refDate: analysis.ref_date ? dateFmt(analysis.ref_date) : null,
      generatedAt: dateFmt(now.toISOString()),
      competitors: competitors.map((c) => c.name || c.domain),
    },
    overview: { rows: overviewRows },
    drivers: driverSections,
    summary,
  }
}

/** Score formatter shared by the generators: null is "—", never 0 (sheet 8). */
export function fmtScore(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)
}
