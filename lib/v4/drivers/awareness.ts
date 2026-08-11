/**
 * V4 driver — Awareness.
 *
 * Source: Ahrefs Site Explorer organic keywords — the DOMAIN's own keywords,
 * NOT the keyword universe (single source, no fallback).
 *
 * METHOD (domain-grounded, Bibbia decision "Fixed 2026-06-22, CRITICAL"):
 * raw = sum of the search volume of the domain's organic keywords in the
 * top 100 positions that CONTAIN a brand term — the branded search demand
 * actually captured by the domain.
 *
 * Why domain-grounded and not the keyword universe (the old matching-terms /
 * keywords-explorer method): on the universe an ambiguous brand token like
 * "fraser" pulled unrelated high-volume terms ("brendan fraser" ~342k) and
 * made a competitor an artificial leader. The domain does not RANK for those
 * terms, so grounding on its own keywords makes that inflation impossible.
 * An imprecise seed only under-counts, never inflates.
 *
 * BRAND TERMS per site (Bibbia 8c): brand seed + configured variants +
 * domain segment, plus space-less variants of multi-word terms. Never
 * `is_branded=true` alone — it flags ANY brand (e.g. the boat brands a
 * dealer sells), not the site's own brand.
 */

import { brandedWhere, fetchOrganicKeywords, type OrganicKeyword } from './ahrefs'
import type { AnalysisSite, DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { assertDeadline, mapPool, round } from './source'

/** The first label of the domain: "benetton.com" -> "benetton". */
export function domainSegment(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '').split('.')[0] ?? ''
}

/**
 * The brand terms of one site: seed + variants + domain segment, with a
 * space-less variant added for every multi-word term ("fraser yachts" also
 * matches "fraseryachts"). Deduped; terms already contained in a shorter
 * term are kept (they only widen the OR, never the result set).
 */
export function brandTerms(site: AnalysisSite): string[] {
  const base = [site.brand_name ?? '', ...(site.brand_variants ?? []), domainSegment(site.domain)]
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  const spaceless = base.filter((t) => t.includes(' ')).map((t) => t.replace(/\s+/g, ''))
  return [...new Set([...base, ...spaceless])]
}

/**
 * Pure: the domain-grounded sum. The brand filter is ALSO applied
 * server-side (brandedWhere); this local re-check keeps the rule testable
 * without the network and guards against a loosened provider filter.
 */
export function sumBrandedVolume(
  keywords: OrganicKeyword[],
  terms: string[],
): { total: number; matched: OrganicKeyword[] } {
  const matched = keywords.filter((k) => {
    const kw = k.keyword.toLowerCase()
    return terms.some((t) => kw.includes(t))
  })
  const total = matched.reduce((sum, k) => sum + (Number.isFinite(k.volume) ? k.volume : 0), 0)
  return { total, matched }
}

export const awarenessWorker: DriverWorker = async (ctx) => {
  const errors: string[] = []

  const measured = await mapPool(ctx.sites, 3, async (site): Promise<SiteRawValue | null> => {
    const terms = brandTerms(site)
    if (terms.length === 0) {
      // Unreachable in practice (the domain segment always exists), kept as
      // an explicit guard: an empty OR filter would match everything.
      errors.push(`Awareness for ${site.domain} — no brand terms could be derived`)
      return null
    }

    try {
      assertDeadline(ctx.deadlineAt, `Awareness for ${site.domain}`)
      const keywords = await fetchOrganicKeywords(site.domain, ctx.country ?? 'it', ctx.refDate, {
        where: brandedWhere(terms),
        what: `Awareness for ${site.domain}`,
      })
      // A brand nobody searches for (or whose demand lands elsewhere) is a
      // real 0 here — the measurement succeeded, the answer is just zero.
      // That is not the same as a failure, which throws and leaves raw null.
      const { total, matched } = sumBrandedVolume(keywords, terms)

      const top = matched
        .slice()
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 5)
        .map((k) => ({
          keyword: k.keyword,
          volume: k.volume,
          share_of_cluster_pct: total > 0 ? round((k.volume / total) * 100, 1) : 0,
        }))

      return {
        site_ref: site.site_ref,
        domain: site.domain,
        raw: total,
        evidence: {
          method: 'domain-grounded',
          brand_terms: terms,
          seed_only_from_domain: !site.brand_name && (site.brand_variants ?? []).length === 0,
          kw_count: matched.length,
          sv_totale_cluster: total,
          top_kw: top,
          endpoint: 'ahrefs:site-explorer/organic-keywords',
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
      error: `Awareness could not be measured for the client site. ${
        errors.join(' | ') || 'no reason reported'
      }`,
      rawPayload: { errors },
    }
  }

  return {
    status: 'done',
    sites,
    rawPayload: {
      source: 'ahrefs:site-explorer/organic-keywords',
      method: 'domain-grounded',
      unmeasured: ctx.sites
        .filter((s) => !sites.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      errors,
    },
  }
}
