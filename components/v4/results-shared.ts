/**
 * V4 results — client-safe shared types and helpers.
 *
 * The insight/summary types are duplicated (minimally) from
 * lib/v4/llm/orchestrator on purpose: importing the orchestrator into a
 * client component would drag the whole server-side LLM stack into the
 * browser bundle. These are the wire shapes of GET /insights, nothing more.
 */

import type React from 'react'
import type { TranslationKey } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** driver_runs.llm_insight / analyses.v4_executive_summary, as the API returns them. */
export type InsightRecord =
  | {
      status: 'done'
      output: Record<string, unknown>
      model: string
      generated_at: string
      attempts: number
      hallucination_flags?: string[]
    }
  | { status: 'error'; error: string; model: string; generated_at: string; attempts: number }

export interface InsightsResponse {
  analysisId: string
  insightsStatus: string | null
  insightsError: string | null
  executiveSummary: InsightRecord | null
  drivers: Array<{
    driver_key: string
    status: string
    llm_sequence: number | null
    insight: InsightRecord | null
  }>
}

export interface SiteMeta {
  site_ref: string
  domain: string
  name: string
  is_client: boolean
}

export interface EditRow {
  id: string
  driver_run_id: string | null
  driver_key: string | null
  field: string
  old_value: unknown
  new_value: unknown
  published: boolean
  published_at: string | null
  created_at: string
}

export interface EditsResponse {
  edits: EditRow[]
  drafts: number
  lastPublishedAt: string | null
  runs: Array<{ id: string; driver_key: string; enabled: boolean; status: string }>
}

// Executive Summary output (sheet 16 C schema, as prompted).
export interface ExecSummaryOutput {
  headline_dominante?: string
  scorecard_overview?: string
  correlazioni_chiave?: Array<{ titolo?: string; spiegazione?: string; driver_coinvolti?: string[] }>
  priorita_strategiche?: Array<{
    titolo?: string
    razionale?: string
    driver_impattati?: string[]
    orizzonte_temporale_mesi?: number
    impatto_atteso?: string
  }>
  alert_critici?: string[]
}

// Per-driver insight outputs (sheet 15 schemas).
export interface DevInsightItem {
  titolo?: string
  spiegazione?: string
  soluzione_proposta?: string
  priorita?: string
}
export interface BusinessInsightItem {
  titolo?: string
  spiegazione?: string
  rilevanza_strategica?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** {pos}/{vol}-style interpolation for translated templates. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  )
}

/**
 * What each driver's raw ACTUALLY measures — the "misura reale" caption that
 * keeps a Relative 100 from reading as an absolute grade (a PSI-57 site shows
 * "100" as leader of its set; the label is what stops the misreading).
 */
export const MEASURE_LABEL_KEY: Record<string, TranslationKey> = {
  awareness: 'v4res.measure_awareness',
  ai_visibility: 'v4res.measure_ai_visibility',
  discoverability: 'v4res.measure_discoverability',
  traffic: 'v4res.measure_traffic',
  compliance: 'v4res.measure_compliance',
  schema: 'v4res.measure_schema',
  speed: 'v4res.measure_speed',
  accessibility: 'v4res.measure_accessibility',
  content: 'v4res.measure_content',
  authority: 'v4res.measure_authority',
}

/** Score band colour (UI only; 9a-style bands). null gets the muted grey. */
export function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return '#6b7280'
  if (score >= 80) return '#c8e64a'
  if (score >= 60) return '#14b8a6'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

export type BandKey = 'critical' | 'weak' | 'good' | 'excellent'

export function bandKey(score: number): BandKey {
  if (score < 40) return 'critical'
  if (score < 60) return 'weak'
  if (score < 80) return 'good'
  return 'excellent'
}

export const PRIORITY_COLORS: Record<string, string> = {
  alta: '#ef4444',
  alto: '#ef4444',
  media: '#f59e0b',
  medio: '#f59e0b',
  bassa: '#6b7280',
  basso: '#6b7280',
}

// ---------------------------------------------------------------------------
// Shared styles (dark V4 workspace theme, same tokens as RunProgress)
// ---------------------------------------------------------------------------

export const card: React.CSSProperties = {
  background: '#1a1c24',
  border: '1px solid #2a2d35',
  borderRadius: '12px',
  padding: '20px 22px',
}

export const sectionTitle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '12px',
  fontWeight: 600,
  color: '#ffffff',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  margin: '0 0 12px 0',
}

export const mutedLabel: React.CSSProperties = {
  fontSize: '11px',
  color: '#6b7280',
  fontFamily: "'JetBrains Mono', monospace",
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

export const pill = (color: string): React.CSSProperties => ({
  fontSize: '11px',
  fontFamily: "'JetBrains Mono', monospace",
  color,
  border: `1px solid ${color}40`,
  borderRadius: '4px',
  padding: '2px 8px',
  whiteSpace: 'nowrap',
})

export const primaryButton = (enabled: boolean): React.CSSProperties => ({
  padding: '10px 20px',
  background: enabled ? '#c8e64a' : '#2a2d35',
  color: enabled ? '#111318' : '#6b7280',
  border: 'none',
  borderRadius: '8px',
  fontWeight: 700,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '13px',
  cursor: enabled ? 'pointer' : 'default',
})

export const ghostButton: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2a2d35',
  borderRadius: '6px',
  color: '#a0a0a0',
  padding: '6px 14px',
  fontSize: '12px',
  cursor: 'pointer',
}
