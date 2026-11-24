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
  /** ms epoch of the Lighthouse run; lets a retry/sibling reuse it only while fresh. */
  at?: number
}

/** A PSI run stays reusable (retry / sibling driver) for this long. */
export const PSI_REUSE_MS = 6 * 60 * 60 * 1000

/** Concurrent PSI calls. Jobs are ordered so in-flight ones hit DIFFERENT origins. */
export const PSI_CONCURRENCY = 5

export const psiKey = (url: string, strategy: string) => `${strategy}|${url}`

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
    // The per-request timeout is CAPPED by the job deadline (Sprint 1 item
    // 1c): a 90s Lighthouse wait started with 20s of budget left used to
    // sail past deadlineAt and get the whole invocation killed with the
    // outcome unwritten — the "running for hours" rows. Below a minimal
    // floor there is no point even starting the request.
    const remaining = deadlineAt ? deadlineAt - Date.now() - 5_000 : Infinity
    if (remaining < 10_000) {
      throw new DriverSourceError(
        `PageSpeed per ${url} (${strategy}): budget di tempo esaurito prima della richiesta, il job verrà ritentato`,
      )
    }
    const timeoutMs = Math.min(90_000, remaining)
    try {
      res = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs) })
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
  return { url, strategy, ...summary, at: Date.now() }
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

/** The bare-domain homepage URL, the single page every site can be measured on. */
export const homepageUrl = (domain: string) => `https://${domain}`

const stripWww = (host: string) => host.toLowerCase().replace(/^www\./, '')

/**
 * Pure: is `url` the homepage of `domain` (same host modulo "www.", path "/",
 * no query)? A locale homepage like /it-it/ is NOT matched on purpose: only
 * the root is a page every site has, so the comparison stays like for like.
 */
export function isHomepageUrl(url: string, domain: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    return (
      stripWww(u.hostname) === stripWww(domain) &&
      (u.pathname === '/' || u.pathname === '') &&
      u.search === ''
    )
  } catch {
    return false
  }
}

/**
 * Pure (Sprint 2 item 19): compress a PSI failure message into the short
 * reason the UI lists next to the unmeasured URL. It is a classification of
 * the messages THIS module produces (fetchPageSpeedForUrl), so the mapping
 * can stay honest: anything unrecognized keeps a clipped original.
 */
export function psiFailureReason(message: string): string {
  if (/timeout|timed? ?out|abort/i.test(message)) return 'timeout'
  if (/returned 429/.test(message)) return 'quota PSI (429)'
  if (/returned 5\d\d/.test(message)) return 'errore PSI 5xx'
  if (/returned 4\d\d/.test(message)) return 'richiesta rifiutata (4xx)'
  if (/budget di tempo esaurito/.test(message)) return 'budget tempo esaurito'
  if (/no lighthouseResult|incomplete Lighthouse/.test(message)) return 'risposta Lighthouse incompleta'
  if (/request failed/i.test(message)) return 'errore di rete'
  return message.length > 80 ? `${message.slice(0, 79)}…` : message
}

/** One (url, strategy) run that produced no measurement, with its reason. */
export interface FailedRun {
  url: string
  strategy: (typeof STRATEGIES)[number]
  reason: string
}

/**
 * Pure: order PSI jobs so that (1) every site is reached before any site's
 * next URL (round-robin by "URL round", fix 24/10) and (2) WITHIN a round all
 * the mobile runs go first, then all the desktop ones — so the jobs in flight
 * together belong to different sites/origins (the same URL is never measured
 * mobile+desktop at once, which can trip bot protection).
 */
export function interleavePsiJobs<T>(perSite: T[][]): T[] {
  const perRound = STRATEGIES.length
  const rounds = Math.max(0, ...perSite.map((jobs) => Math.ceil(jobs.length / perRound)))
  const out: T[] = []
  for (let r = 0; r < rounds; r++) {
    for (let s = 0; s < perRound; s++) {
      for (const jobs of perSite) {
        const job = jobs[r * perRound + s]
        if (job !== undefined) out.push(job)
      }
    }
  }
  return out
}

export interface PsiSetResult {
  sites: SiteRawValue[]
  errors: string[]
  measurements: PageMeasurement[]
  templatesConfigured: boolean
  /** True when the score was taken on the homepages only (template pages not all measurable). */
  homepageFallback?: boolean
  /** Item 19: every failed (url, strategy) run with its domain and reason. */
  failedRuns?: Array<FailedRun & { domain: string }>
  /** Runs that were NOT attempted/finished because the invocation budget ran out. */
  budgetCut?: number
  /** Total (url, strategy) combinations the set asks for. */
  totalRuns?: number
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
  // Item 19: per-URL failures with the synthesized reason, keyed by site so
  // each site's evidence lists exactly ITS unmeasured runs.
  const failedBySite = new Map<string, FailedRun[]>()

  // Fix 24/10: ROUND-ROBIN order. The old site-by-site order let the client
  // (many templates x 2 strategies) eat the whole invocation budget, so the
  // competitors queued behind it were never reached ("budget di tempo
  // esaurito" on every competitor, Speed AND Accessibility measuring only
  // Ariston). Now round 1 measures the first URL of EVERY site, round 2 the
  // second, ... so a budget cut leaves every site partially measured instead
  // of some sites not at all.
  const jobs = interleavePsiJobs(
    ctx.sites.map((site) =>
      urlsForSite(ctx, site).flatMap((url) =>
        STRATEGIES.map((strategy) => ({ site, url, strategy })),
      ),
    ),
  )

  // Runs already done recently (own previous attempt, or the sibling PSI
  // driver — one Lighthouse call carries BOTH categories) are reused, so a
  // retry RESUMES where the last invocation stopped instead of starting over.
  const cache = new Map<string, PageMeasurement>()
  const now = Date.now()
  for (const m of ctx.priorPsi ?? []) {
    if (typeof m.at === 'number' && now - m.at <= PSI_REUSE_MS) cache.set(psiKey(m.url, m.strategy), m)
  }
  let budgetCut = 0

  // Jobs are ordered strategy-major per round, so concurrent ones hit
  // different origins: PSI_CONCURRENCY in flight is safe, and (at 2 before)
  // it was the bottleneck that left every competitor unreached in 280s.
  const results = await mapPool(jobs, PSI_CONCURRENCY, async (job) => {
    try {
      const hit = cache.get(psiKey(job.url, job.strategy))
      if (hit) {
        measurements.push(hit)
        return { site_ref: job.site.site_ref, m: hit }
      }
      assertDeadline(ctx.deadlineAt, `${category} for ${job.url}`)
      const m = await fetchPageSpeedForUrl(job.url, job.strategy, ctx.deadlineAt)
      measurements.push(m)
      return { site_ref: job.site.site_ref, m }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/deadline reached|budget di tempo esaurito/.test(message)) budgetCut += 1
      errors.push(message)
      const list = failedBySite.get(job.site.site_ref) ?? []
      list.push({ url: job.url, strategy: job.strategy, reason: psiFailureReason(message) })
      failedBySite.set(job.site.site_ref, list)
      return null
    }
  })

  const scoreOf = (m: PageMeasurement) =>
    category === 'performance' ? m.performance_score : m.accessibility_score

  const sites: SiteRawValue[] = []
  for (const site of ctx.sites) {
    const own = results.filter((r) => r && r.site_ref === site.site_ref)
    const attempted = jobs.filter((j) => j.site.site_ref === site.site_ref).length
    const avg = mean(own.map((r) => scoreOf(r!.m)))
    if (avg === null) continue

    const failed = failedBySite.get(site.site_ref) ?? []
    sites.push({
      site_ref: site.site_ref,
      domain: site.domain,
      raw: round(avg, 1),
      score_absolute: Math.round(avg),
      evidence: {
        pages: own.map((r) => ({
          url: r!.m.url,
          strategy: r!.m.strategy,
          score: scoreOf(r!.m),
        })),
        measured_runs: own.length,
        attempted_runs: attempted,
        // Coverage honesty: a mean over 1 of 4 runs is a different claim
        // than a mean over 4 of 4. The Controller warns below 100%.
        ...(own.length < attempted
          ? { coverage_note: `misurate ${own.length} combinazioni su ${attempted} tentate` }
          : {}),
        // Item 19: WHICH runs failed and WHY (timeout, 5xx, quota) — the UI
        // lists them under the score instead of a bare percentage.
        ...(failed.length > 0 ? { failed_runs: failed } : {}),
      },
    })
  }

  // ---- Homepage-only fallback (agreed with the team) ----------------------
  // When, on the LAST attempt, the configured template pages could not all be
  // measured, a lopsided template mean is not comparable between sites. The
  // score is then taken on the HOMEPAGES only (mobile + desktop), the same
  // basis for every site, and the note says so on every site and in the
  // payload. Never silent: scope + fallback + the template runs that failed.
  const lastAttempt = (ctx.attempt ?? 1) >= (ctx.maxAttempts ?? 1)
  const templatesConfigured = ctx.templates.some((t) => t.url)
  const incomplete = ctx.sites.some((site) => {
    const attempted = jobs.filter((j) => j.site.site_ref === site.site_ref).length
    const done = results.filter((r) => r && r.site_ref === site.site_ref).length
    return done < attempted
  })
  let fallback: { sites: SiteRawValue[] } | null = null
  if (templatesConfigured && incomplete && lastAttempt) {
    fallback = await measureHomepages(ctx, category, measurements, errors, cache, failedBySite)
  }

  const failedRuns = ctx.sites.flatMap((site) =>
    (failedBySite.get(site.site_ref) ?? []).map((f) => ({ ...f, domain: site.domain })),
  )

  return {
    sites: fallback ? fallback.sites : sites,
    errors,
    measurements,
    templatesConfigured,
    ...(fallback ? { homepageFallback: true } : {}),
    budgetCut,
    totalRuns: jobs.length,
    ...(failedRuns.length > 0 ? { failedRuns } : {}),
  }
}

/**
 * Homepage-only pass (fallback). Measures https://<domain> on mobile and
 * desktop for every site, reusing any run already available (cache, or a
 * configured homepage template measured earlier). Returns the per-site
 * values on THAT basis, or null when the client homepage could not be
 * measured: the caller then keeps the template result and its coverage
 * notes, exactly as before.
 */
async function measureHomepages(
  ctx: DriverJobContext,
  category: PsiCategory,
  measurements: PageMeasurement[],
  errors: string[],
  cache: Map<string, PageMeasurement>,
  failedBySite: Map<string, FailedRun[]>,
): Promise<{ sites: SiteRawValue[] } | null> {
  const scoreOf = (m: PageMeasurement) =>
    category === 'performance' ? m.performance_score : m.accessibility_score
  const jobs = interleavePsiJobs(
    ctx.sites.map((site) =>
      STRATEGIES.map((strategy) => ({ site, url: homepageUrl(site.domain), strategy })),
    ),
  )
  const done = await mapPool(jobs, PSI_CONCURRENCY, async (job) => {
    // A homepage run already in hand (cache or earlier in this attempt).
    const known =
      cache.get(psiKey(job.url, job.strategy)) ??
      measurements.find(
        (m) => m.strategy === job.strategy && isHomepageUrl(m.url, job.site.domain),
      )
    if (known) return { site_ref: job.site.site_ref, m: known }
    try {
      assertDeadline(ctx.deadlineAt, `${category} homepage ${job.url}`)
      const m = await fetchPageSpeedForUrl(job.url, job.strategy, ctx.deadlineAt)
      measurements.push(m)
      return { site_ref: job.site.site_ref, m }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(message)
      const list = failedBySite.get(job.site.site_ref) ?? []
      list.push({ url: job.url, strategy: job.strategy, reason: psiFailureReason(message) })
      failedBySite.set(job.site.site_ref, list)
      return null
    }
  })

  const sites: SiteRawValue[] = []
  for (const site of ctx.sites) {
    const own = done.filter((r) => r && r.site_ref === site.site_ref)
    const avg = mean(own.map((r) => scoreOf(r!.m)))
    if (avg === null) continue
    sites.push({
      site_ref: site.site_ref,
      domain: site.domain,
      raw: round(avg, 1),
      score_absolute: Math.round(avg),
      evidence: {
        pages: own.map((r) => ({ url: r!.m.url, strategy: r!.m.strategy, score: scoreOf(r!.m) })),
        measured_runs: own.length,
        attempted_runs: STRATEGIES.length,
        fallback: 'homepage',
        scope_note: HOMEPAGE_FALLBACK_NOTE,
        ...(own.length < STRATEGIES.length
          ? { coverage_note: `misurate ${own.length} combinazioni su ${STRATEGIES.length} (homepage)` }
          : {}),
      },
    })
  }

  const clientRef = ctx.sites.find((s) => s.is_client)?.site_ref
  if (!sites.some((s) => s.site_ref === clientRef)) return null
  return { sites }
}

/** Shown on every site scored through the fallback and in the payload. */
export const HOMEPAGE_FALLBACK_NOTE =
  'Alcune pagine dei template non sono state misurabili: il punteggio è calcolato sulle sole ' +
  'homepage (mobile e desktop), con la stessa base per tutti i siti.'


/** Shared outcome shaping for the two PSI drivers. */
export function psiOutcome(
  ctx: DriverJobContext,
  category: PsiCategory,
  result: PsiSetResult,
  label: string,
) {
  const clientRef = ctx.sites.find((s) => s.is_client)?.site_ref
  // Persisted so the next attempt (and the sibling PSI driver) can reuse them.
  const savedMeasurements = result.measurements.map((m) => ({
    url: m.url,
    strategy: m.strategy,
    performance_score: m.performance_score,
    accessibility_score: m.accessibility_score,
    at: m.at,
  }))

  // Budget ran out with attempts left: do NOT publish a score on a lopsided
  // sample (the client measured, competitors not => "relative 100" is a lie).
  // Fail retryably; the runner re-queues and the next attempt resumes from the
  // saved measurements. On the last attempt the partial result is published,
  // flagged as such (coverage notes + triangle).
  const attempt = ctx.attempt ?? 1
  const maxAttempts = ctx.maxAttempts ?? 1
  if ((result.budgetCut ?? 0) > 0 && attempt < maxAttempts) {
    return {
      status: 'error' as const,
      error:
        `${label}: misurate ${result.measurements.length} combinazioni su ${result.totalRuns ?? '?'}, ` +
        `tempo esaurito (tentativo ${attempt}/${maxAttempts}); riprendo dal punto raggiunto.`,
      rawPayload: { measurements: savedMeasurements, errors: result.errors },
    }
  }

  if (!result.sites.some((s) => s.site_ref === clientRef)) {
    return {
      status: 'error' as const,
      error: `${label} could not be measured for the client site. ${
        result.errors.join(' | ') || 'no reason reported'
      }`,
      rawPayload: { errors: result.errors, measurements: savedMeasurements },
    }
  }

  return {
    status: 'done' as const,
    sites: result.sites,
    rawPayload: {
      measurements: savedMeasurements,
      source: 'google:pagespeed-insights/v5',
      category,
      // Explicit, because it changes what the number means.
      scope: result.homepageFallback
        ? 'homepage only (fallback: not every configured template page could be measured), mobile + desktop'
        : result.templatesConfigured
          ? 'configured page templates, mobile + desktop'
          : 'homepage only (no page templates configured yet), mobile + desktop',
      ...(result.homepageFallback
        ? { fallback: 'homepage', scope_note: HOMEPAGE_FALLBACK_NOTE }
        : {}),
      unmeasured: ctx.sites
        .filter((s) => !result.sites.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      // Item 19: url-level failures with the synthesized reason, so a site
      // that could not be measured AT ALL (absent from `sites`) still tells
      // WHY per url in the payload the status route reads.
      ...(result.failedRuns && result.failedRuns.length > 0
        ? { failed_runs: result.failedRuns }
        : {}),
      errors: result.errors,
    },
  }
}
