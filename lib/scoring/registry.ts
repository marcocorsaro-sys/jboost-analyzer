/**
 * V4 driver registry — the 10-driver catalog of the Drivers Bibbia (03).
 *
 * Lives ALONGSIDE the V1 registry (lib/constants.ts DRIVERS) during the
 * migration: V1 keys keep working untouched until the runner and the UI
 * flip to V4 (blocks 2 and 6 of the reuse map). Nothing in the V1 code
 * path imports this file yet.
 *
 * Two orderings coexist by spec (README 01 §3):
 *  - catalogOrder 1-10: the reference/catalog numbering of sheets 7/8c
 *    (1 Compliance ... 10 Traffic). An index, NOT the display order.
 *  - uiOrder: Business-first display order for setup and results
 *    (Awareness, AI Visibility, Discoverability, Traffic, then the six
 *    Development drivers).
 */

export type DriverFamily = 'business' | 'development'
export type V4NormalizationMode = 'linear' | 'logarithmic'

export interface V4DriverDef {
  /** V4 machine key (snake_case) — used in DB, payloads, scoring. */
  key: string
  label: string
  family: DriverFamily
  /** Catalog/reference numbering of sheets 7 and 8c (NOT display order). */
  catalogOrder: number
  /** Business-first display order (setup wizard + results tabs). */
  uiOrder: number
  /**
   * Business drivers REQUIRE >=1 competitor and cannot be enabled
   * without one (sheet 5 section D; setup gating in UX-UI Bibbia).
   */
  competitorMandatory: boolean
  /** Leader-index variant (sheet 8): log10 only for Traffic today. */
  normalization: V4NormalizationMode
  /**
   * Whether the driver has an Absolute view (intrinsic raw 0-100).
   * The 6 Development drivers + AI Visibility (the exception) do;
   * Discoverability, Awareness and Traffic are relative-only.
   */
  hasAbsoluteView: boolean
  /**
   * Position in the sequential LLM run of sheet 16 (1-9), or null for
   * AI Visibility which has its own paste-driven LLM step.
   */
  llmSequence: number | null
  /** Default weight in the overall aggregate (sheet 8 section D). */
  defaultWeight: number
  /** Primary data source label (Settings / driver card). */
  source: string
  /** Corresponding V1 driver key in lib/constants.ts, if any. */
  v1Key: string | null
  /** Lucide icon name (UI). */
  icon: string
}

export const V4_DRIVERS: readonly V4DriverDef[] = [
  // ----- Business (competitor-mandatory, displayed first) --------------
  {
    key: 'awareness', label: 'Awareness', family: 'business',
    catalogOrder: 9, uiOrder: 1, competitorMandatory: true,
    normalization: 'linear', hasAbsoluteView: false, llmSequence: 1,
    defaultWeight: 1, source: 'Ahrefs Site Explorer (domain-grounded branded volume)',
    v1Key: 'awareness', icon: 'Eye',
  },
  {
    key: 'ai_visibility', label: 'AI Visibility', family: 'business',
    catalogOrder: 7, uiOrder: 2, competitorMandatory: true,
    normalization: 'linear', hasAbsoluteView: true, llmSequence: null,
    defaultWeight: 1, source: 'J-Horizon (paste-driven GEO score)',
    v1Key: 'ai_relevance', icon: 'Brain',
  },
  {
    key: 'discoverability', label: 'Discoverability', family: 'business',
    catalogOrder: 6, uiOrder: 3, competitorMandatory: true,
    normalization: 'linear', hasAbsoluteView: false, llmSequence: 2,
    defaultWeight: 1, source: 'Ahrefs Site Explorer (no-brand quality count, top-10 / vol>=1000)',
    v1Key: 'discoverability', icon: 'Search',
  },
  {
    key: 'traffic', label: 'Traffic', family: 'business',
    catalogOrder: 10, uiOrder: 4, competitorMandatory: true,
    normalization: 'logarithmic', hasAbsoluteView: false, llmSequence: 3,
    defaultWeight: 1, source: 'Similarweb (mean monthly visits, last 3 months)',
    v1Key: null, icon: 'TrendingUp',
  },
  // ----- Development (competitor-optional) -----------------------------
  {
    key: 'compliance', label: 'Compliance', family: 'development',
    catalogOrder: 1, uiOrder: 5, competitorMandatory: false,
    normalization: 'linear', hasAbsoluteView: true, llmSequence: 5,
    defaultWeight: 1, source: 'Semrush Site Audit (Site Health, read-only)',
    v1Key: 'compliance', icon: 'Shield',
  },
  {
    key: 'schema', label: 'Schema', family: 'development',
    catalogOrder: 2, uiOrder: 6, competitorMandatory: false,
    normalization: 'linear', hasAbsoluteView: true, llmSequence: 7,
    defaultWeight: 1, source: 'Firecrawl + knowledge base (weighted clusters 50/35/15)',
    v1Key: null, icon: 'Braces',
  },
  {
    key: 'speed', label: 'Speed', family: 'development',
    catalogOrder: 3, uiOrder: 7, competitorMandatory: false,
    normalization: 'linear', hasAbsoluteView: true, llmSequence: 8,
    defaultWeight: 1, source: 'Google PageSpeed Insights (per template x device)',
    v1Key: 'experience', icon: 'Gauge',
  },
  {
    key: 'accessibility', label: 'Accessibility', family: 'development',
    catalogOrder: 4, uiOrder: 8, competitorMandatory: false,
    normalization: 'linear', hasAbsoluteView: true, llmSequence: 9,
    defaultWeight: 1, source: 'Google PageSpeed Insights (same call as Speed)',
    v1Key: 'accessibility', icon: 'Accessibility',
  },
  {
    key: 'content', label: 'Content', family: 'development',
    catalogOrder: 5, uiOrder: 9, competitorMandatory: false,
    normalization: 'linear', hasAbsoluteView: true, llmSequence: 6,
    defaultWeight: 1, source: 'Analyst questionnaire per template (sheets 9a/9b)',
    v1Key: 'content', icon: 'FileText',
  },
  {
    key: 'authority', label: 'Authority', family: 'development',
    catalogOrder: 8, uiOrder: 10, competitorMandatory: false,
    normalization: 'linear', hasAbsoluteView: true, llmSequence: 4,
    defaultWeight: 1, source: 'Ahrefs Site Explorer (Domain Rating + history)',
    v1Key: 'authority', icon: 'Award',
  },
] as const

export type V4DriverKey = (typeof V4_DRIVERS)[number]['key']

/** Keys of drivers normalized logarithmically ("log_drivers" contract). */
export const V4_LOG_DRIVERS: V4DriverKey[] = V4_DRIVERS
  .filter((d) => d.normalization === 'logarithmic')
  .map((d) => d.key)

export const V4_BUSINESS_DRIVERS: V4DriverKey[] = V4_DRIVERS
  .filter((d) => d.family === 'business')
  .map((d) => d.key)

export const V4_DEVELOPMENT_DRIVERS: V4DriverKey[] = V4_DRIVERS
  .filter((d) => d.family === 'development')
  .map((d) => d.key)

/** Drivers removed from scope in V4 (decision 2026-06-22). */
export const V4_REMOVED_V1_KEYS = ['aso_visibility'] as const

export function getV4Driver(key: string): V4DriverDef | undefined {
  return V4_DRIVERS.find((d) => d.key === key)
}

/** Display order for setup + results (Business first — README 01 §3). */
export function driversInUiOrder(): V4DriverDef[] {
  return [...V4_DRIVERS].sort((a, b) => a.uiOrder - b.uiOrder)
}

/** Sequential LLM run order of sheet 16 (AI Visibility excluded). */
export function driversInLlmOrder(): V4DriverDef[] {
  return V4_DRIVERS
    .filter((d) => d.llmSequence !== null)
    .sort((a, b) => (a.llmSequence! - b.llmSequence!))
}

/** Map a V1 driver key to its V4 definition (rename-aware). */
export function fromV1Key(v1Key: string): V4DriverDef | undefined {
  return V4_DRIVERS.find((d) => d.v1Key === v1Key)
}

/** Driver-run lifecycle states (Drivers Bibbia sheet 1 / UI sheet 3). */
export const DRIVER_RUN_STATUSES = [
  'queued', 'running', 'done', 'error', 'needs_decision',
] as const
export type DriverRunStatus = (typeof DRIVER_RUN_STATUSES)[number]

/** Discoverability tier cascade (strict first; extend is user-decided). */
export const DISCO_TIERS = [
  { key: 'strict',    pos: 10,  vol: 1000 },
  { key: 'relaxed_2', pos: 20,  vol: 500 },
  { key: 'relaxed_3', pos: 100, vol: 100 },
] as const
export type DiscoTierKey = (typeof DISCO_TIERS)[number]['key']
