/**
 * V4 async runner — shared types.
 *
 * The V4 execution model (reuse map §6): one job per driver, persisted in
 * driver_runs with its own state, instead of the V1 global phase sequence.
 * A job is dispatched into its own Vercel invocation, so each one sits
 * comfortably under maxDuration once unpacked from the 1.703-line monolith.
 */

import type { DriverRunStatus, V4DriverKey } from '@/lib/scoring/registry'

/** Stable reference for a site inside one analysis (matches the DB CHECKs). */
export type SiteRef = 'client' | 'competitor_1' | 'competitor_2' | 'competitor_3' | 'competitor_4'

export interface AnalysisSite {
  site_ref: SiteRef
  /** Bare domain: no protocol, no www., lowercase (sheet 8b conventions). */
  domain: string
  /** Display name ("Cliente", "Competitor 1"...). */
  name: string
  is_client: boolean
  /** Brand terms for the domain-grounded drivers (Awareness). */
  brand_name?: string | null
  brand_variants?: string[]
}

/**
 * One page template of one site (template_configs).
 *
 * Shared by Speed / Accessibility / Schema / Content: they must all measure
 * the SAME pages, otherwise the scores are not comparable across the set.
 */
export interface TemplateConfig {
  site_ref: SiteRef
  template_key: string
  /** null = the template does not exist on this site. */
  url: string | null
  applies_to: string[]
}

/** Everything a driver worker needs. No Supabase handle: workers stay pure-ish. */
export interface DriverJobContext {
  analysisId: string
  driverKey: V4DriverKey
  sites: AnalysisSite[]
  /**
   * Page templates configured for this analysis (empty until the Block 3
   * setup wizard exists). A worker that needs pages decides its own fallback
   * and MUST record which URLs it actually measured.
   */
  templates: TemplateConfig[]
  /** Per-driver setup config (driver_runs.config). */
  config: Record<string, unknown>
  /** REF_DATE frozen at launch: last day of the last complete month. */
  refDate: string | null
  country: string | null
  /** Decision the analyst already took on a previous needs_decision pause. */
  decisionTaken?: Record<string, unknown> | null
  /** Cooperative deadline so a worker can stop before the invocation is killed. */
  deadlineAt: number
}

/** One site's measurement for this driver. */
export interface SiteRawValue {
  site_ref: SiteRef
  domain: string
  /** null = not measured / not available. Never coerce to 0 (sheet 8). */
  raw: number | null
  /** Intrinsic 0-100, only for drivers with an Absolute view. */
  score_absolute?: number | null
  /** Free-form evidence for the driver panel (tables, URLs, counts). */
  evidence?: Record<string, unknown>
}

/**
 * What a worker returns. The runner — not the worker — decides how this maps
 * onto driver_runs columns, so a worker never touches the DB.
 */
export type DriverJobOutcome =
  | {
      status: 'done'
      sites: SiteRawValue[]
      /** Discoverability transparency: which tier actually produced the count. */
      tierUsed?: 'strict' | 'relaxed_2' | 'relaxed_3' | null
      rawPayload?: Record<string, unknown>
    }
  | {
      /**
       * The job cannot proceed without an analyst choice (Discoverability
       * empty-tier cascade). Never resolved automatically: comparing sites
       * measured at different tiers would compare different things.
       */
      status: 'needs_decision'
      decisionRequest: Record<string, unknown>
      rawPayload?: Record<string, unknown>
    }
  | {
      status: 'error'
      error: string
      rawPayload?: Record<string, unknown>
    }

export type DriverWorker = (ctx: DriverJobContext) => Promise<DriverJobOutcome>

/** driver_runs row, as the runner reads it. */
export interface DriverRunRow {
  id: string
  analysis_id: string
  driver_key: V4DriverKey
  enabled: boolean
  config: Record<string, unknown>
  status: DriverRunStatus
  raw_value: number | null
  score_absolute: number | null
  score_relative: number | null
  tier_used: string | null
  raw_payload: Record<string, unknown>
  /** Pause payload written by the worker (what the analyst must choose). */
  decision_request: Record<string, unknown> | null
  /** The choice the analyst already made, replayed into the next attempt. */
  decision_taken: Record<string, unknown> | null
  error: string | null
  edited: boolean
  attempts: number
  max_attempts: number
  started_at: string | null
  completed_at: string | null
  lease_expires_at: string | null
  /** When a dispatcher last handed this job to a worker route. */
  dispatched_at: string | null
  created_at: string
}
