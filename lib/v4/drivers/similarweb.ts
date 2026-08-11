/**
 * V4 — Similarweb source module (Traffic).
 *
 * Single source per the Bibbia (sheet 7 row 10, 8c/8d VERIFIED): the Digital
 * Intelligence API `total-traffic-and-engagement/visits`, monthly granularity,
 * per site. No substitute — the Semrush/Ahrefs numbers on hand estimate
 * ORGANIC traffic, which is a different quantity than total visits.
 *
 * Coverage is the one failure mode that is NOT a source outage: Similarweb
 * simply has no panel data for small domains, and answers 404 (or an empty
 * series). Sheet 17 "Traffic fallback" (2026-06-22) decides what that means:
 * the analysis CONTINUES with an alert to review the competitor list, instead
 * of blocking the driver. So coverage gets its own error class, letting the
 * worker tell "this domain is below coverage" apart from "the API is broken",
 * which stays a hard DriverSourceError like every other source.
 *
 * Country is MANDATORY: Similarweb rejects 'ww' with web_source=total
 * (Bibbia 8c), so there is no world-wide fallback to silently reach for.
 */

import { DriverSourceError } from './source'

const SIMILARWEB_API_BASE = 'https://api.similarweb.com/v1'

/** The domain exists but Similarweb has no panel data for it (404 / empty). */
export class SimilarwebCoverageError extends DriverSourceError {
  constructor(domain: string, detail: string) {
    super(`${domain} è sotto la soglia di coverage Similarweb (${detail}): nessun dato visite disponibile.`)
    this.name = 'SimilarwebCoverageError'
  }
}

export function hasSimilarwebKey(): boolean {
  return Boolean(process.env.SIMILARWEB_API_KEY)
}

function apiKey(): string {
  const key = process.env.SIMILARWEB_API_KEY
  if (!key) throw new DriverSourceError('SIMILARWEB_API_KEY is not configured')
  return key
}

/** One month of the visits series. `date` is what the API returns (YYYY-MM-DD). */
export interface MonthlyVisits {
  date: string
  visits: number
}

/**
 * Pure: the monthly window to request, relative to the frozen REF_DATE.
 *
 * From 6 months before the REF_DATE month to the month BEFORE it — six full
 * months, enough for the 3m average AND the 3m-vs-previous-3m trend. Wide on
 * purpose: Similarweb data for the freshest month can lag, and asking for a
 * window is cheaper than asking twice.
 *
 * With refDate=null (analysis launched before the planner froze one) the
 * reference month falls back to the last complete month relative to `now`,
 * the same rule as computeRefDate.
 */
export function visitsWindow(
  refDate: string | null,
  now: Date = new Date(),
): { start: string; end: string } {
  let year: number
  let monthIndex: number // 0-based month of the REF_DATE
  const m = refDate?.match(/^(\d{4})-(\d{2})/)
  if (m) {
    year = Number(m[1])
    monthIndex = Number(m[2]) - 1
  } else {
    const lastComplete = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    year = lastComplete.getUTCFullYear()
    monthIndex = lastComplete.getUTCMonth()
  }

  const fmt = (offset: number): string => {
    const d = new Date(Date.UTC(year, monthIndex + offset, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  return { start: fmt(-6), end: fmt(-1) }
}

/**
 * The monthly visits series for one domain.
 *
 * Throws SimilarwebCoverageError on 404 or an empty/unusable series (the
 * "domain below coverage" case the worker is allowed to survive), and
 * DriverSourceError on everything else (auth, quota, transport — a broken
 * source, never a zero).
 */
export async function fetchMonthlyVisits(
  domain: string,
  country: string,
  window: { start: string; end: string },
  what: string,
): Promise<MonthlyVisits[]> {
  const params = new URLSearchParams({
    api_key: apiKey(),
    start_date: window.start,
    end_date: window.end,
    country: country.toLowerCase(),
    granularity: 'monthly',
    main_domain_only: 'false',
    format: 'json',
  })

  let res: Response
  try {
    res = await fetch(
      `${SIMILARWEB_API_BASE}/website/${encodeURIComponent(domain)}/total-traffic-and-engagement/visits?${params.toString()}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) },
    )
  } catch (err) {
    throw new DriverSourceError(
      `${what} — Similarweb request failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (res.status === 404) {
    throw new SimilarwebCoverageError(domain, 'HTTP 404')
  }
  if (!res.ok) {
    throw new DriverSourceError(`${what} — Similarweb answered ${res.status}`)
  }

  const body = (await res.json()) as { visits?: unknown }
  if (!Array.isArray(body.visits)) {
    throw new SimilarwebCoverageError(domain, 'risposta senza serie visits')
  }

  const rows = (body.visits as Array<Record<string, unknown>>)
    .filter((r) => typeof r.visits === 'number' && Number.isFinite(r.visits))
    .map((r) => ({ date: String(r.date ?? ''), visits: r.visits as number }))

  if (rows.length === 0) {
    throw new SimilarwebCoverageError(domain, 'serie visits vuota nella finestra richiesta')
  }
  return rows
}
