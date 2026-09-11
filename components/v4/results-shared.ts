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
import type { DriverRow } from './RunProgress'
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
  runs: Array<{ id: string; driver_key: string; enabled: boolean; status: string; edited?: boolean }>
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

/**
 * Semantic colour for a RELATIVE (leader-index) score, mockup thresholds:
 * >= 70 green, 30-69 amber, < 30 red. null stays muted (never 0, never red).
 */
export function relBandColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return B.muted
  if (score >= 70) return B.success
  if (score >= 30) return B.warning
  return B.error
}

// ---------------------------------------------------------------------------
// LEADER-INDEX per sito (hero band + tabella confronto)
// ---------------------------------------------------------------------------

export interface SetIndexEntry {
  site_ref: string
  domain: string
  /** Mean of the site's non-null score_relative across done drivers. */
  index: number | null
  /** 1 = leader of the set; null when the site has no measured driver. */
  rank: number | null
}

export interface SetIndex {
  /** One entry per site of the set, leader first (nulls last). */
  entries: SetIndexEntry[]
  /** Drivers 'done' that contributed at least one measured score. */
  measuredDrivers: number
}

/**
 * Per-site LEADER-INDEX aggregate for the hero band and the comparison table.
 *
 * Mirrors scoreSet().overall (lib/scoring/leader-index, sheet 8 section D,
 * weights = 1) and computeOverallScore (lib/v4/audits): mean of the non-null
 * score_relative across enabled done drivers — null EXCLUDED, never 0. For
 * the client the row-level score_relative wins (analyst edits survive), the
 * competitors use the per-site normalized score.
 */
export function computeSetIndex(rows: DriverRow[]): SetIndex {
  const done = rows.filter((r) => r.enabled && r.status === 'done')
  const acc = new Map<string, { domain: string; sum: number; n: number }>()
  let measuredDrivers = 0

  for (const row of done) {
    let counted = false
    for (const s of row.sites) {
      const score =
        s.site_ref === 'client'
          ? (row.score_relative ?? s.score_relative ?? null)
          : (s.score_relative ?? null)
      const cur = acc.get(s.site_ref) ?? { domain: s.domain, sum: 0, n: 0 }
      if (typeof score === 'number' && Number.isFinite(score)) {
        cur.sum += score
        cur.n += 1
        counted = true
      }
      acc.set(s.site_ref, cur)
    }
    if (counted) measuredDrivers += 1
  }

  const entries: SetIndexEntry[] = [...acc.entries()].map(([site_ref, v]) => ({
    site_ref,
    domain: v.domain,
    index: v.n > 0 ? Math.round(v.sum / v.n) : null,
    rank: null,
  }))

  // Competition ranking (1,2,2,4) on the index, descending; nulls unranked.
  const sorted = entries
    .map((e) => e.index)
    .filter((x): x is number => x !== null)
    .sort((a, b) => b - a)
  for (const e of entries) {
    e.rank = e.index === null ? null : sorted.indexOf(e.index) + 1
  }
  entries.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))

  return { entries, measuredDrivers }
}

/**
 * Tab-bar status dot per driver (mockup): green = done, red = done but
 * critical relative score (< 30), amber = needs_decision, grey = queued /
 * running / error (still waiting for a good measurement).
 */
export function driverDotColor(row: DriverRow): string {
  if (row.status === 'done') {
    return typeof row.score_relative === 'number' && row.score_relative < 30 ? B.error : B.success
  }
  if (row.status === 'needs_decision') return B.warning
  return B.mutedLight
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

// ---------------------------------------------------------------------------
// Mockup UX (approvato) — hero band, tab bar, dots, minibar, card tratteggiata
// ---------------------------------------------------------------------------

/** HERO band navy: gradient primary → inkPanel, radius 20, white content. */
export const heroBand: React.CSSProperties = {
  background: `linear-gradient(120deg, ${B.primary} 0%, ${B.inkPanel} 100%)`,
  borderRadius: '20px',
  color: B.onPrimary,
  padding: '36px 40px',
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto',
  gap: '48px',
  alignItems: 'center',
  position: 'relative',
  overflow: 'hidden',
}

/** Decorative "goccia" in the hero's top-right corner (brand mark shape). */
export const heroDrop: React.CSSProperties = {
  position: 'absolute',
  right: '-60px',
  top: '-80px',
  width: '280px',
  height: '280px',
  background: 'rgba(255, 255, 255, 0.06)',
  borderRadius: '50% 50% 50% 8px',
  transform: 'rotate(45deg)',
  pointerEvents: 'none',
}

/** Tab strip container: one white rail with soft shadow (mockup .tabs). */
export const tabBar: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  background: B.bg,
  border: `1px solid ${B.border}`,
  borderRadius: '14px',
  padding: '6px',
  overflowX: 'auto',
  boxShadow: B.shadow.card,
}

/** One tab: active = solid navy, inactive = quiet text (mockup .tab). */
export const tabItem = (active: boolean): React.CSSProperties => ({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 16px',
  borderRadius: '10px',
  fontSize: '15px',
  fontWeight: 600,
  color: active ? B.onPrimary : B.muted,
  background: active ? B.primary : 'transparent',
  border: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: B.transition,
  fontFamily: 'inherit',
})

/** Status dot for tabs (green done, red critical, amber decision, grey wait). */
export const statusDot = (color: string): React.CSSProperties => ({
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  background: color,
  flexShrink: 0,
})

/** Minibar track under the Overview card score (mockup .minibar). */
export const miniBarTrack: React.CSSProperties = {
  marginTop: '14px',
  height: '6px',
  background: B.surface,
  borderRadius: B.radius.pill,
  overflow: 'hidden',
}

/** Minibar fill, proportional and semantically coloured. */
export const miniBarFill = (pct: number, color: string): React.CSSProperties => ({
  display: 'block',
  height: '100%',
  width: `${Math.max(0, Math.min(100, pct))}%`,
  borderRadius: B.radius.pill,
  background: color,
})

/** Dashed card for drivers waiting on the analyst (mockup .card.pending). */
export const dashedCard: React.CSSProperties = {
  ...card,
  borderStyle: 'dashed',
}
