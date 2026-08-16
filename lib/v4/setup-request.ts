/**
 * V4 setup — the HTTP request shape shared by POST /api/v4/analyses (create)
 * and PATCH /api/v4/analyses/[id] (update a not-yet-started draft).
 *
 * Lives outside the route files because a Next route module may only export
 * handlers, and the two routes must accept EXACTLY the same body: a draft
 * saved by one and updated by the other is the same object.
 *
 * Zod checks the wire format only; the domain rules (required-at-launch,
 * cluster bounds, template URLs) stay in lib/v4/setup.ts where they are pure
 * and tested.
 */

import { z } from 'zod'
import {
  INDUSTRY_PRESETS,
  buildV4SetupJson,
  mergeV4Setup,
  type SetupInput,
} from '@/lib/v4/setup'
import type { AnalysisSite } from '@/lib/v4/runner/types'

const Site = z.object({
  domain: z.string().min(1),
  brandName: z.string().nullable().optional(),
  brandVariants: z.array(z.string()).optional(),
})

export const SetupBody = z.object({
  clientId: z.string().uuid().nullable().optional(),
  client: Site,
  competitors: z.array(Site).default([]),
  country: z.string().min(2).default('IT'),
  countries: z.array(z.string()).optional(),
  outputLanguage: z.enum(['it', 'en']).default('it'),
  industryPreset: z.enum(INDUSTRY_PRESETS).nullable().optional(),
  sector: z.string().nullable().optional(),
  siteType: z.string().nullable().optional(),
  targetAudienceMode: z.enum(['b2b', 'b2c', 'both']).nullable().optional(),
  targetAudience: z.string().nullable().optional(),
  seoMaturity: z.enum(['low', 'medium', 'high']).nullable().optional(),
  /** Empty is legal for a draft; the launch requires the Business four. */
  drivers: z.array(z.string()).default([]),
  templates: z.record(z.record(z.string())).optional(),
  driverTemplates: z.record(z.array(z.string())).optional(),
  jhorizonAnswer: z.string().nullable().optional(),
  thematicClusters: z.array(z.string()).optional(),
  blocklist: z.array(z.string()).optional(),
  maxInsights: z.number().nullable().optional(),
  additionalNotes: z.string().nullable().optional(),
  mode: z.enum(['draft', 'launch']).default('launch'),
})

export type SetupRequest = z.infer<typeof SetupBody>

/** The wire body as the pure validator wants it. */
export function toSetupInput(parsed: SetupRequest): SetupInput {
  return { ...parsed, countries: parsed.countries ?? countriesFallback(parsed.country) }
}

function countriesFallback(country: string): string[] {
  return country.trim() ? [country.trim().toUpperCase()] : []
}

/**
 * The analyses columns both routes write. `existingV4Setup` carries the
 * attachments uploaded on the draft across an update — the files route owns
 * that key, a setup save must never wipe it.
 */
export function analysisColumnsFromSetup(
  parsed: SetupRequest,
  clientSite: AnalysisSite,
  competitorSites: AnalysisSite[],
  existingV4Setup: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const input = toSetupInput(parsed)
  const countries = input.countries ?? []
  return {
    domain: clientSite.domain,
    country: countries[0] ?? parsed.country,
    language: parsed.outputLanguage,
    // V1 column, kept in sync so the legacy lists keep rendering.
    competitors: competitorSites.map((s) => s.domain),
    brand_name: clientSite.brand_name,
    brand_variants: clientSite.brand_variants ?? [],
    site_type: parsed.siteType ?? null,
    industry_preset: parsed.industryPreset ?? null,
    target_audience: parsed.targetAudience ?? null,
    seo_maturity: parsed.seoMaturity ?? null,
    output_language: parsed.outputLanguage,
    competitor_details: competitorSites.map((s) => ({
      domain: s.domain,
      brand_name: s.brand_name,
      brand_variants: s.brand_variants ?? [],
    })),
    // Field #22 → the guardrails the LLM orchestrator already reads.
    llm_guardrails: {
      blocklist: (parsed.blocklist ?? []).map((w) => w.trim()).filter(Boolean),
      ...(typeof parsed.maxInsights === 'number' ? { max_insights: parsed.maxInsights } : {}),
    },
    v4_setup: mergeV4Setup(existingV4Setup, buildV4SetupJson(input)),
  }
}
