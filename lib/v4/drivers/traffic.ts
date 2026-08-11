/**
 * V4 driver — Traffic (Similarweb, Bibbia sheet 7 row 10).
 *
 * Raw = mean monthly visits over the LAST 3 AVAILABLE months of the requested
 * window (Similarweb can lag or skip a month; averaging the 3 most recent
 * months actually present keeps the comparison honest without pretending a
 * missing month was zero). Fewer than 1 usable month = not measured.
 *
 * Relative only, LOGARITHMIC leader-index — but that lives in the scoring
 * core (registry: normalization 'logarithmic'); this worker returns the raw
 * visits and nothing derived from them.
 *
 * Failure policy is sheet 17 "Traffic fallback" (2026-06-22), which is
 * SOFTER than the original 8c blocking rule: a domain below Similarweb
 * coverage does not block the analysis. A COMPETITOR below coverage stays
 * unmeasured with a coverage alert ("rivedi la lista competitor") and the
 * driver completes; the CLIENT below coverage (or failing for any reason)
 * is still a hard error, because a Traffic driver that cannot see the
 * client measures nothing.
 *
 * Country is mandatory: Similarweb rejects 'ww' with web_source=total, so a
 * missing country is a setup error the driver names — never silently 'ww'.
 */

import type { DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { assertDeadline, mapPool, mean, round } from './source'
import {
  fetchMonthlyVisits,
  hasSimilarwebKey,
  visitsWindow,
  SimilarwebCoverageError,
  type MonthlyVisits,
} from './similarweb'

/**
 * Pure: mean of the last `n` AVAILABLE months (sorted by date). A gap in the
 * middle of the series just shifts which months are "the last 3" — the raw
 * stays an average of real measurements, never padded with zeros.
 */
export function averageLastMonths(
  rows: MonthlyVisits[],
  n = 3,
): { avg: number | null; used: MonthlyVisits[] } {
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date))
  const used = sorted.slice(-n)
  return { avg: mean(used.map((r) => r.visits)), used }
}

/**
 * Pure: % delta of the last `n` available months vs the `n` before them.
 * null when the series does not cover both windows — a partial trend would
 * compare a full quarter against a stub.
 */
export function trendPct(rows: MonthlyVisits[], n = 3): number | null {
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 2 * n) return null
  const recent = mean(sorted.slice(-n).map((r) => r.visits))
  const prior = mean(sorted.slice(-2 * n, -n).map((r) => r.visits))
  if (recent === null || prior === null || prior === 0) return null
  return round((100 * (recent - prior)) / prior, 1)
}

export const trafficWorker: DriverWorker = async (ctx) => {
  // Similarweb rejects 'ww' with web_source=total: no country, no measurement.
  if (!ctx.country) {
    return {
      status: 'error',
      error:
        'Traffic richiede un country ISO2 esplicito: Similarweb rifiuta "ww" con web_source=total, ' +
        'quindi senza country del setup il driver non può misurare nulla.',
      rawPayload: { source: 'similarweb:total-traffic-and-engagement/visits' },
    }
  }

  // Checked up front so five sites do not produce five copies of the same
  // missing-credential error.
  if (!hasSimilarwebKey()) {
    return {
      status: 'error',
      error:
        'SIMILARWEB_API_KEY non configurata: il driver Traffic usa esclusivamente Similarweb ' +
        '(total-traffic-and-engagement/visits) e senza credenziali non può misurare nulla.',
      rawPayload: { source: 'similarweb:total-traffic-and-engagement/visits' },
    }
  }

  const country = ctx.country
  const window = visitsWindow(ctx.refDate)
  const coverageAlerts: Array<{ domain: string; reason: string }> = []
  const errors: string[] = []

  const measured = await mapPool(ctx.sites, 3, async (site) => {
    try {
      assertDeadline(ctx.deadlineAt, `Traffic for ${site.domain}`)
      const rows = await fetchMonthlyVisits(site.domain, country, window, `Traffic for ${site.domain}`)
      const { avg, used } = averageLastMonths(rows)
      if (avg === null) {
        coverageAlerts.push({ domain: site.domain, reason: 'nessun mese di dati nella finestra richiesta' })
        return null
      }
      return { site, rows, avg, used }
    } catch (err) {
      if (err instanceof SimilarwebCoverageError) {
        // Sheet 17: below-coverage is an alert, not a block.
        coverageAlerts.push({ domain: site.domain, reason: err.message })
      } else {
        errors.push(err instanceof Error ? err.message : String(err))
      }
      return null
    }
  })

  const ok = measured.filter((m): m is NonNullable<typeof m> => m !== null)

  const client = ok.find((m) => m.site.is_client)
  if (!client) {
    const clientDomain = ctx.sites.find((s) => s.is_client)?.domain ?? 'client'
    const coverage = coverageAlerts.find((a) => a.domain === clientDomain)
    return {
      status: 'error',
      error:
        `Traffic non misurabile per il sito cliente (${clientDomain}). ` +
        (coverage ? coverage.reason : errors.join(' | ') || 'nessun motivo riportato'),
      rawPayload: { source: 'similarweb:total-traffic-and-engagement/visits', window, coverage_alerts: coverageAlerts, errors },
    }
  }

  const sites: SiteRawValue[] = ok.map((m) => {
    const evidence: Record<string, unknown> = {
      visits_avg_3m: round(m.avg, 1),
      months_used: m.used,
      endpoint: 'similarweb:total-traffic-and-engagement/visits',
    }
    if (m.site.is_client) {
      // 3m-vs-previous-3m, only when the window really covers both quarters.
      evidence.trend_3m_vs_prev_3m_pct = trendPct(m.rows)
    }
    return {
      site_ref: m.site.site_ref,
      domain: m.site.domain,
      // Raw visits (integer per spec) — the log10 normalization is the
      // scoring core's job, never the worker's.
      raw: Math.round(m.avg),
      evidence,
    }
  })

  return {
    status: 'done',
    sites,
    rawPayload: {
      source: 'similarweb:total-traffic-and-engagement/visits',
      window,
      country: country.toLowerCase(),
      trend_client_pct: trendPct(client.rows),
      coverage_alerts: coverageAlerts,
      ...(coverageAlerts.length > 0
        ? { coverage_note: 'Domini sotto coverage Similarweb: rivedi la lista competitor.' }
        : {}),
      unmeasured: ctx.sites
        .filter((s) => !sites.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      errors,
    },
  }
}
