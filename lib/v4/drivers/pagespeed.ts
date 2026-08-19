/**
 * V4 — PageSpeed Insights source, shared by Speed and Accessibility.
 *
 * Both drivers come from the SAME Lighthouse run (spec: "stessa chiamata di
 * Speed"), and both are the mean of the category score over every
 * (template, strategy) pair.
 *
 * Why not reuse lib/seo-apis/pagespeed.fetchPageSpeed: it only accepts a bare
 * domain (it hardcodes `https://${domain}`) so it cannot measure a template
 * URL, and on any failure it returns performance 0 / accessibility 0 — a
 * fabricated worst-case score that is indistinguishable from a real one. V4
 * needs a fetch that fails instead. The response parsing is still the V1
 * `summarizePageSpeed`, so the two stay in sync.
 */

import { summarizePageSpeed } from '@/lib/seo-apis/pagespeed'
import type { AnalysisSite, DriverJobContext, SiteRawValue } from '@/lib/v4/runner/types'
import { DriverSourceError, assertDeadline, mapPool, mean, round } from './source'

const PSI_API_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
const STRATEGIES = ['mobile', 'desktop'] as const

export type PsiCategory = 'performance' | 'accessibility'

export interface PageMeasurement {
  url: string
  strategy: (typeof STRATEGIES)[number]
  performance_score: number
  accessibility_score: number
}

/** 5xx and 429 are transient in PSI (Lighthouse hiccups, rate spikes). */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * One Lighthouse run. Throws on anything that is not a real result — no
 * zero-score fallback.
 *
 * RETRIES (first live run lesson): PSI answers 500 routinely and
 * transiently — the same URL succeeds seconds later. Without retries a
 * 4-page sweep collapsed to a single measurement and the mean stopped
 * being representative. Transient failures (5xx, 429, network/timeout)
 * get up to 2 more attempts with 3s/6s backoff; 4xx are real errors and
 * fail immediately. The retry budget respects the job deadline.
 */
export async function fetchPageSpeedForUrl(
  url: string,
  strategy: (typeof STRATEGIES)[number],
  deadlineAt?: number,
): Promise<PageMeasurement> {
  const key = process.env.GOOGLE_PSI_API_KEY
  if (!key) throw new DriverSourceError('GOOGLE_PSI_API_KEY is not configured')

  const endpoint =
    `${PSI_API_BASE}?url=${encodeURIComponent(url)}&key=${key}&strategy=${strategy}` +
    '&category=performance&category=accessibility'

  const MAX_ATTEMPTS = 3
  let res: Response | null = null
  let lastError: string | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const backoff = attempt === 2 ? 3_000 : 6_000
      if (deadlineAt && Date.now() + backoff + 30_000 > deadlineAt) break
      await sleep(backoff)
    }
    try {
      res = await fetch(endpoint, { signal: AbortSignal.timeout(90_000) })
    } catch (err) {
      lastError = `PageSpeed request failed for ${url} (${strategy}): ${err instanceof Error ? err.message : String(err)}`
      res = null
      continue // network/timeout: transient, retry
    }
    if (res.ok) break
    lastError = `PageSpeed returned ${res.status} for ${url} (${strategy})`
    if (!isRetryableStatus(res.status)) {
      throw new DriverSourceError(lastError)
    }
    res = null
  }

  if (!res) {
    throw new DriverSourceError(
      `${lastError ?? `PageSpeed failed for ${url} (${strategy})`} (dopo ${MAX_ATTEMPTS} tentativi)`,
    )
  }

  const body = (await res.json()) as { lighthouseResult?: Record<string, unknown> }
  if (!body.lighthouseResult) {
    throw new DriverSourceError(`PageSpeed returned no lighthouseResult for ${url} (${strategy})`)
  }

  // summarizePageSpeed defaults a missing category to 0. That is fine for V1
  // but would silently become a real score here, so check before trusting it.
  const categories = body.lighthouseResult.categories as
    | Record<string, { score: number | null }>
    | undefined
  if (
    categories?.performance?.score == null ||
    categories?.accessibility?.score == null
  ) {
    throw new DriverSourceError(
      `PageSpeed returned an incomplete Lighthouse result for ${url} (${strategy})`,
    )
  }

  const summary = summarizePageSpeed(body.lighthouseResult)
  return { url, strategy, ...summary }
}

/**
 * The URLs to measure for one site.
 *
 * Until the Block 3 setup wizard populates template_configs, there are no
 * templates and the only page we can honestly claim to know is the homepage.
 * The set is measured the same way for every site, so the comparison stays
 * fair — and the URLs actually used are recorded in the evidence so nobody
 * mistakes a homepage-only score for a full template sweep.
 */
export function urlsForSite(ctx: DriverJobContext, site: AnalysisSite): string[] {
  const configured = ctx.templates
    .filter((t) => t.site_ref === site.site_ref && t.url)
    .map((t) => t.url as string)

  return configured.length > 0 ? configured : [`https://${site.domain}`]
}

export interface PsiSetResult {
  sites: SiteRawValue[]
  errors: string[]
  measurements: PageMeasurement[]
  templatesConfigured: boolean
}

/**
 * Measure the whole set and reduce it to one score per site.
 *
 * A site whose pages all fail is left OUT (raw stays null and is excluded
 * from the normalization) rather than scored 0.
 */
export async function measureSet(
  ctx: DriverJobContext,
  category: PsiCategory,
): Promise<PsiSetResult> {
  const errors: string[] = []
  const measurements: PageMeasurement[] = []

  const jobs = ctx.sites.flatMap((site) =>
    urlsForSite(ctx, site).flatMap((url) =>
      STRATEGIES.map((strategy) => ({ site, url, strategy })),
    ),
  )

  // 2 in flight: PSI rate-limits hard AND two parallel Lighthouse runs on
  // the same origin can trip bot protection — the retries (3 attempts with
  // backoff) still keep a 5-site set inside the invocation budget.
  const results = await mapPool(jobs, 2, async (job) => {
    try {
      assertDeadline(ctx.deadlineAt, `${category} for ${job.url}`)
      const m = await fetchPageSpeedForUrl(job.url, job.strategy, ctx.deadlineAt)
      measurements.push(m)
      return { site_ref: job.site.site_ref, m }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
      return null
    }
  })

  const sites: SiteRawValue[] = []
  for (const site of ctx.sites) {
    const own = results.filter((r) => r && r.site_ref === site.site_ref)
    const attempted = jobs.filter((j) => j.site.site_ref === site.site_ref).length
    const scores = own.map((r) =>
      category === 'performance' ? r!.m.performance_score : r!.m.accessibility_score,
    )
    const avg = mean(scores)
    if (avg === null) continue

    sites.push({
      site_ref: site.site_ref,
      domain: site.domain,
      raw: round(avg, 1),
      score_absolute: Math.round(avg),
      evidence: {
        pages: own.map((r) => ({
          url: r!.m.url,
          strategy: r!.m.strategy,
          score: category === 'performance' ? r!.m.performance_score : r!.m.accessibility_score,
        })),
        measured_runs: own.length,
        attempted_runs: attempted,
        // Coverage honesty: a mean over 1 of 4 runs is a different claim
        // than a mean over 4 of 4. The Controller warns below 100%.
        ...(own.length < attempted
          ? { coverage_note: `misurate ${own.length} combinazioni su ${attempted} tentate` }
          : {}),
      },
    })
  }

  return {
    sites,
    errors,
    measurements,
    templatesConfigured: ctx.templates.some((t) => t.url),
  }
}

/** Shared outcome shaping for the two PSI drivers. */
export function psiOutcome(
  ctx: DriverJobContext,
  category: PsiCategory,
  result: PsiSetResult,
  label: string,
) {
  const clientRef = ctx.sites.find((s) => s.is_client)?.site_ref
  if (!result.sites.some((s) => s.site_ref === clientRef)) {
    return {
      status: 'error' as const,
      error: `${label} could not be measured for the client site. ${
        result.errors.join(' | ') || 'no reason reported'
      }`,
      rawPayload: { errors: result.errors },
    }
  }

  return {
    status: 'done' as const,
    sites: result.sites,
    rawPayload: {
      source: 'google:pagespeed-insights/v5',
      category,
      // Explicit, because it changes what the number means.
      scope: result.templatesConfigured
        ? 'configured page templates, mobile + desktop'
        : 'homepage only (no page templates configured yet), mobile + desktop',
      unmeasured: ctx.sites
        .filter((s) => !result.sites.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      errors: result.errors,
    },
  }
}
