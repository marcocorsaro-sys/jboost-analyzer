/**
 * V4 driver — Authority.
 *
 * Source: Ahrefs site-explorer/domain-rating (single source, no fallback).
 * Formula (spec, sources table): score_absolute = round(domain_rating).
 * The raw fed to the leader index is the DR itself, so the Relative view is
 * the linear leader index over the set and the Absolute view is the DR.
 *
 * One API call per site. Cheap, so the whole set is measured in one job.
 */

import { fetchDomainRating } from '@/lib/seo-apis/ahrefs'
import type { DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { DriverSourceError, assertDeadline, mapPool, requireLive } from './source'

export const authorityWorker: DriverWorker = async (ctx) => {
  const errors: string[] = []

  const sites = await mapPool(ctx.sites, 3, async (site): Promise<SiteRawValue | null> => {
    try {
      assertDeadline(ctx.deadlineAt, `Authority for ${site.domain}`)
      const dr = requireLive(
        await fetchDomainRating(site.domain),
        `Authority for ${site.domain}`,
      )
      const rounded = Math.round(dr.domain_rating)
      return {
        site_ref: site.site_ref,
        domain: site.domain,
        raw: rounded,
        score_absolute: rounded,
        evidence: {
          domain_rating: dr.domain_rating,
          ahrefs_rank: dr.ahrefs_rank,
          endpoint: 'ahrefs:site-explorer/domain-rating',
        },
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
      return null
    }
  })

  const measured = sites.filter((s): s is SiteRawValue => s !== null)

  // The client is the subject of the report: without it there is nothing to
  // score, and a set of competitor-only numbers would be worse than an error.
  const clientRef = ctx.sites.find((s) => s.is_client)?.site_ref
  if (!measured.some((s) => s.site_ref === clientRef)) {
    return {
      status: 'error',
      error:
        `Authority could not be measured for the client site. ${errors.join(' | ') || 'no reason reported'}`,
      rawPayload: { errors },
    }
  }

  return {
    status: 'done',
    sites: measured,
    rawPayload: {
      source: 'ahrefs:site-explorer/domain-rating',
      // Competitors that failed stay null and are EXCLUDED from the
      // normalization (sheet 8) — never counted as 0.
      unmeasured: ctx.sites
        .filter((s) => !measured.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      errors,
    },
  }
}

/** Exported for tests: the failure type callers should expect. */
export { DriverSourceError }
