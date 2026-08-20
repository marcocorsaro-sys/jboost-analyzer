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
import { B } from '@/lib/brand'

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

/**
 * Score band colour (UI only; 9a-style bands). null gets the muted grey.
 * Tones picked to stay readable on the white JAKALA surfaces (AA).
 */
export function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return B.muted
  if (score >= 80) return B.success
  if (score >= 60) return B.teal
  if (score >= 40) return B.warning
  return B.error
}

export type BandKey = 'critical' | 'weak' | 'good' | 'excellent'

export function bandKey(score: number): BandKey {
  if (score < 40) return 'critical'
  if (score < 60) return 'weak'
  if (score < 80) return 'good'
  return 'excellent'
}

export const PRIORITY_COLORS: Record<string, string> = {
  alta: B.error,
  alto: B.error,
  media: B.warning,
  medio: B.warning,
  bassa: B.muted,
  basso: B.muted,
}

// ---------------------------------------------------------------------------
// Shared styles (white JAKALA workspace theme, tokens from lib/brand.ts)
// ---------------------------------------------------------------------------

/** Premium card: white surface, hairline border, generous padding, soft lift. */
export const card: React.CSSProperties = {
  background: B.bg,
  border: `1px solid ${B.border}`,
  borderRadius: B.radius.card,
  padding: '28px 32px',
  boxShadow: B.shadow.card,
}

/** Section heading inside a card — a real title, not a micro-label. */
export const sectionTitle: React.CSSProperties = {
  ...B.type.h2,
  color: B.ink,
  margin: '0 0 16px 0',
}

/** Micro-label: the ONLY sub-14px text allowed. Uppercase, wide tracking. */
export const mutedLabel: React.CSSProperties = {
  ...B.type.label,
  color: B.muted,
}

/** Soft pill badge: tinted background, readable 13px/600, full radius. */
export const pill = (color: string): React.CSSProperties => ({
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.3,
  color,
  background: `${color}14`,
  border: `1px solid ${color}26`,
  borderRadius: B.radius.pill,
  padding: '5px 12px',
  whiteSpace: 'nowrap',
})

export const primaryButton = (enabled: boolean): React.CSSProperties => ({
  padding: '12px 20px',
  background: enabled ? B.primary : B.surface2,
  color: enabled ? B.onPrimary : B.muted,
  border: 'none',
  borderRadius: B.radius.control,
  fontWeight: 650,
  fontSize: '15px',
  lineHeight: 1.3,
  cursor: enabled ? 'pointer' : 'default',
  transition: B.transition,
})

export const ghostButton: React.CSSProperties = {
  background: B.bg,
  border: `1px solid ${B.border}`,
  borderRadius: B.radius.control,
  color: B.muted,
  padding: '10px 16px',
  fontSize: '14px',
  fontWeight: 600,
  lineHeight: 1.3,
  cursor: 'pointer',
  transition: B.transition,
}

/** Hero score number — the protagonist of every score card. */
export const displayNum: React.CSSProperties = {
  ...B.type.display,
  ...B.type.num,
}

/** Secondary big number — competitor chips, stat tiles, table numbers. */
export const displayNumSm: React.CSSProperties = {
  ...B.type.displaySm,
  ...B.type.num,
}

/** Page H1 — one per page. */
export const pageTitle: React.CSSProperties = {
  ...B.type.h1,
  color: B.ink,
  margin: 0,
}
