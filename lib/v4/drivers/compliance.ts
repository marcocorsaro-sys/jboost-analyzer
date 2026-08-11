/**
 * V4 driver — Compliance.
 *
 * Source: Semrush Site Audit, READ-ONLY (single source, no fallback).
 *
 * SCORE (Bibbia, Resolved 2026-06-22): raw = the Semrush SITE HEALTH score
 * (info.quality.value, natively 0-100). NO custom formula — the earlier
 * errors/crawled_pages ratio is superseded; it needed calibration Semrush
 * has already done.
 *
 * The issue breakdown (meta_issues + issue_details) feeds the QUALITATIVE
 * issues table only, never the score. Structured-data issues are flagged as
 * belonging to the Schema driver so the table can show ownership without
 * double-charging.
 *
 * Operationally: the USER creates the Semrush project and runs the crawl in
 * Semrush; the app only reads the latest snapshot. A domain with no project
 * (competitors, usually) is unmeasured with a reason — in V1 that returned a
 * mock and silently produced a plausible score, which is the exact bug the
 * V4 spec calls out.
 */

import { fetchSiteHealth } from '@/lib/seo-apis/semrush'
import type { SemrushSiteIssue } from '@/lib/seo-apis/types'
import type { DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { DriverSourceError, assertDeadline, mapPool, requireLive } from './source'

/**
 * Structured-data issues belong to the Schema driver. Semrush exposes issues
 * as free-text titles, so this is a keyword match, not a stable taxonomy:
 * flagged issues stay visible in the qualitative table, marked with their
 * owner, so the classification can be audited rather than trusted.
 */
const STRUCTURED_DATA_RE = /structured data|schema\.org|schema markup|json-?ld|microdata|rich (result|snippet)/i

export function isStructuredDataIssue(issue: SemrushSiteIssue): boolean {
  return STRUCTURED_DATA_RE.test(issue.title)
}

export interface ComplianceRaw {
  siteHealth: number
  topIssues: Array<{
    title: string
    type: SemrushSiteIssue['type']
    pages_count: number
    owned_by: 'compliance' | 'schema'
  }>
}

/**
 * Pure: raw = Site Health, issues classified for the qualitative table.
 * A missing Site Health is a hard error — the project exists but the crawl
 * has not produced a quality value, so there is nothing to score. Never 0.
 */
export function computeCompliance(
  siteHealth: number | null,
  issues: SemrushSiteIssue[],
): ComplianceRaw {
  if (siteHealth === null || !Number.isFinite(siteHealth)) {
    throw new DriverSourceError(
      'Semrush Site Audit reported no Site Health score: the crawl has not completed ' +
        '(or the project has never been crawled), so there is nothing to score',
    )
  }
  if (siteHealth < 0 || siteHealth > 100) {
    throw new DriverSourceError(
      `Semrush Site Health out of range: ${siteHealth} (expected 0-100)`,
    )
  }

  const topIssues = issues
    .slice()
    .sort((a, b) => (b.pages_count || 0) - (a.pages_count || 0))
    .slice(0, 10)
    .map((i) => ({
      title: i.title,
      type: i.type,
      pages_count: i.pages_count,
      owned_by: (isStructuredDataIssue(i) ? 'schema' : 'compliance') as 'compliance' | 'schema',
    }))

  return { siteHealth, topIssues }
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
      const computed = computeCompliance(health.site_health_score, health.issues)
      return {
        site_ref: site.site_ref,
        domain: site.domain,
        raw: computed.siteHealth,
        score_absolute: Math.round(computed.siteHealth),
        evidence: {
          site_health: computed.siteHealth,
          site_health_delta: health.site_health_delta,
          pages_crawled: health.pages_crawled,
          top_issues: computed.topIssues,
          note: 'score = Semrush Site Health (info.quality.value); issues are qualitative only',
          endpoint: 'semrush:management/v1/siteaudit (read-only)',
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
        'Score = Site Health, read from the user-provisioned Semrush project (the app never ' +
        'starts crawls). Domains without a project are reported as unmeasured, never scored.',
      unmeasured: ctx.sites
        .filter((s) => !measured.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      errors,
    },
  }
}
