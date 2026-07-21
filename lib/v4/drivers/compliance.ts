/**
 * V4 driver — Compliance.
 *
 * Source: SEMrush Site Audit (single source, no fallback).
 * Formula (spec):
 *   ratio = total_errors / crawled_pages
 *   score = 100 * (1 - ratio), floored at 0 and capped at 100
 * counting only non-structured-data errors (the structured-data issues belong
 * to the Schema driver and must not be charged twice).
 *
 * IMPORTANT operational note: SEMrush Site Audit only returns data for domains
 * that have a configured project in the SEMrush account. Competitor domains
 * almost never do. In V1 that returned a mock and the driver silently produced
 * a plausible score; here it blocks with an explicit reason, which is the
 * behaviour the spec mandates and the only honest one.
 */

import { fetchSiteHealth } from '@/lib/seo-apis/semrush'
import type { SemrushSiteIssue } from '@/lib/seo-apis/types'
import type { DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { DriverSourceError, assertDeadline, mapPool, requireLive, round } from './source'

/**
 * Structured-data issues are scored by the Schema driver, not here.
 *
 * SEMrush exposes issues as free-text titles, so this is a keyword match, not
 * a stable taxonomy: the excluded titles are recorded in the evidence so the
 * exclusion can be audited rather than trusted.
 */
const STRUCTURED_DATA_RE = /structured data|schema\.org|schema markup|json-?ld|microdata|rich (result|snippet)/i

export function isStructuredDataIssue(issue: SemrushSiteIssue): boolean {
  return STRUCTURED_DATA_RE.test(issue.title)
}

export interface ComplianceComputation {
  score: number
  totalErrors: number
  pagesCrawled: number
  excluded: string[]
  counted: Array<{ title: string; pages_count: number }>
}

/** Pure: the spec formula, so it can be tested without touching the network. */
export function computeCompliance(
  issues: SemrushSiteIssue[],
  pagesCrawled: number,
): ComplianceComputation {
  if (!Number.isFinite(pagesCrawled) || pagesCrawled <= 0) {
    throw new DriverSourceError(
      'SEMrush Site Audit reported 0 crawled pages: there is no denominator, so no score can be computed',
    )
  }

  const errorIssues = issues.filter((i) => i.type === 'error')
  const excluded = errorIssues.filter(isStructuredDataIssue)
  const counted = errorIssues.filter((i) => !isStructuredDataIssue(i))

  const totalErrors = counted.reduce((sum, i) => sum + (i.pages_count || 0), 0)
  const ratio = totalErrors / pagesCrawled
  const score = Math.min(100, Math.max(0, 100 * (1 - ratio)))

  return {
    score: round(score, 1),
    totalErrors,
    pagesCrawled,
    excluded: excluded.map((i) => i.title),
    counted: counted.map((i) => ({ title: i.title, pages_count: i.pages_count })),
  }
}

export const complianceWorker: DriverWorker = async (ctx) => {
  const errors: string[] = []

  const sites = await mapPool(ctx.sites, 2, async (site): Promise<SiteRawValue | null> => {
    try {
      assertDeadline(ctx.deadlineAt, `Compliance for ${site.domain}`)
      const health = requireLive(
        await fetchSiteHealth(site.domain),
        `Compliance for ${site.domain}`,
      )
      const computed = computeCompliance(health.issues, health.pages_crawled)
      return {
        site_ref: site.site_ref,
        domain: site.domain,
        raw: computed.score,
        score_absolute: Math.round(computed.score),
        evidence: {
          total_errors: computed.totalErrors,
          pages_crawled: computed.pagesCrawled,
          counted_issues: computed.counted,
          excluded_structured_data_issues: computed.excluded,
          site_health_score: health.site_health_score,
          endpoint: 'semrush:management/v1/siteaudit',
        },
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
      return null
    }
  })

  const measured = sites.filter((s): s is SiteRawValue => s !== null)

  const clientRef = ctx.sites.find((s) => s.is_client)?.site_ref
  if (!measured.some((s) => s.site_ref === clientRef)) {
    return {
      status: 'error',
      error:
        `Compliance could not be measured for the client site. ${errors.join(' | ') || 'no reason reported'}`,
      rawPayload: { errors },
    }
  }

  return {
    status: 'done',
    sites: measured,
    rawPayload: {
      source: 'semrush:site-audit',
      note:
        'Requires a configured SEMrush Site Audit project per domain; domains without one are ' +
        'reported as unmeasured, never scored.',
      unmeasured: ctx.sites
        .filter((s) => !measured.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      errors,
    },
  }
}
