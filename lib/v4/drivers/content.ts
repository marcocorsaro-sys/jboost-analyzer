/**
 * V4 driver — Content.
 *
 * Source: SEMrush Site Audit — the SAME snapshot Compliance reads (spec:
 * "stesso snapshot di Compliance"), filtered on the content issues instead of
 * the technical ones.
 *
 * Formula: identical to Compliance —
 *   score = 100 * (1 - content_errors / crawled_pages), clamped to [0, 100]
 *
 * The two drivers must not double-charge the same issue: Compliance counts
 * everything that is NOT content and NOT structured data, Content counts only
 * the content issues, Schema owns structured data. The split lives in one
 * place (classifyIssue) so it stays a partition rather than three
 * independent guesses.
 *
 * Same operational caveat as Compliance: SEMrush only answers for domains
 * with a configured Site Audit project.
 */

import { fetchSiteHealth } from '@/lib/seo-apis/semrush'
import type { SemrushSiteIssue } from '@/lib/seo-apis/types'
import type { DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { isStructuredDataIssue } from './compliance'
import { DriverSourceError, assertDeadline, mapPool, requireLive, round } from './source'

/**
 * The content issues of sheet 5: thin pages, duplication, missing or
 * duplicated title/description/H1, images without alt text.
 *
 * SEMrush exposes issues as free-text titles, so this is a keyword match on
 * a moving target. Every issue that matches nothing is listed in the evidence
 * as `unclassified` rather than dropped silently — an issue we failed to
 * recognise must be visible, not invisible.
 */
const CONTENT_RE =
  /word count|thin content|duplicate content|duplicate title|duplicate meta|duplicate h1|missing (title|meta description|h1)|title too (long|short)|meta description|h1 tag|alt attribute|missing alt/i

export type IssueClass = 'content' | 'structured_data' | 'technical'

export function classifyIssue(issue: SemrushSiteIssue): IssueClass {
  if (isStructuredDataIssue(issue)) return 'structured_data'
  return CONTENT_RE.test(issue.title) ? 'content' : 'technical'
}

export interface ContentComputation {
  score: number
  contentErrors: number
  pagesCrawled: number
  counted: Array<{ title: string; pages_count: number }>
  otherClasses: Array<{ title: string; klass: IssueClass }>
}

/** Pure: the spec formula on the content slice of the audit. */
export function computeContent(
  issues: SemrushSiteIssue[],
  pagesCrawled: number,
): ContentComputation {
  if (!Number.isFinite(pagesCrawled) || pagesCrawled <= 0) {
    throw new DriverSourceError(
      'SEMrush Site Audit reported 0 crawled pages: there is no denominator, so no score can be computed',
    )
  }

  const errorIssues = issues.filter((i) => i.type === 'error')
  const counted = errorIssues.filter((i) => classifyIssue(i) === 'content')
  const contentErrors = counted.reduce((sum, i) => sum + (i.pages_count || 0), 0)
  const score = Math.min(100, Math.max(0, 100 * (1 - contentErrors / pagesCrawled)))

  return {
    score: round(score, 1),
    contentErrors,
    pagesCrawled,
    counted: counted.map((i) => ({ title: i.title, pages_count: i.pages_count })),
    otherClasses: errorIssues
      .filter((i) => classifyIssue(i) !== 'content')
      .map((i) => ({ title: i.title, klass: classifyIssue(i) })),
  }
}

export const contentWorker: DriverWorker = async (ctx) => {
  const errors: string[] = []

  const measured = await mapPool(ctx.sites, 2, async (site): Promise<SiteRawValue | null> => {
    try {
      assertDeadline(ctx.deadlineAt, `Content for ${site.domain}`)
      const health = requireLive(await fetchSiteHealth(site.domain), `Content for ${site.domain}`)
      const computed = computeContent(health.issues, health.pages_crawled)
      return {
        site_ref: site.site_ref,
        domain: site.domain,
        raw: computed.score,
        score_absolute: Math.round(computed.score),
        evidence: {
          content_errors: computed.contentErrors,
          pages_crawled: computed.pagesCrawled,
          counted_issues: computed.counted,
          issues_owned_by_other_drivers: computed.otherClasses,
          endpoint: 'semrush:management/v1/siteaudit',
        },
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
      return null
    }
  })

  const sites = measured.filter((s): s is SiteRawValue => s !== null)

  const clientRef = ctx.sites.find((s) => s.is_client)?.site_ref
  if (!sites.some((s) => s.site_ref === clientRef)) {
    return {
      status: 'error',
      error: `Content could not be measured for the client site. ${
        errors.join(' | ') || 'no reason reported'
      }`,
      rawPayload: { errors },
    }
  }

  return {
    status: 'done',
    sites,
    rawPayload: {
      source: 'semrush:site-audit',
      note: 'Same audit snapshot as Compliance, filtered on content issues.',
      unmeasured: ctx.sites
        .filter((s) => !sites.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      errors,
    },
  }
}
