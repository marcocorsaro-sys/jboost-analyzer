/**
 * V4 driver — Awareness.
 *
 * Source: Ahrefs Keywords Explorer (single source, no fallback).
 * Raw: total monthly search volume of the site's BRAND cluster — how many
 * people look for the brand by name. Relative only: a volume is meaningless
 * without the competitors to size it against.
 *
 * The brand cluster is the brand name plus the variants entered in setup.
 * A site with no brand name configured cannot be measured: guessing the brand
 * from the domain ("benetton.com" -> "benetton") would work often enough to
 * be dangerous and silently wrong for the rest.
 */

import { fetchKeywordVolumes } from './ahrefs'
import type { AnalysisSite, DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { assertDeadline, mapPool } from './source'

/** The keyword cluster of one site: brand name + configured variants. */
export function brandCluster(site: AnalysisSite): string[] {
  const terms = [site.brand_name ?? '', ...(site.brand_variants ?? [])]
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(terms)]
}

export const awarenessWorker: DriverWorker = async (ctx) => {
  const errors: string[] = []

  const measured = await mapPool(ctx.sites, 3, async (site): Promise<SiteRawValue | null> => {
    const cluster = brandCluster(site)
    if (cluster.length === 0) {
      errors.push(
        `Awareness for ${site.domain} — no brand name configured. The brand cluster cannot be ` +
          'derived from the domain without guessing, so the site is left unmeasured.',
      )
      return null
    }

    try {
      assertDeadline(ctx.deadlineAt, `Awareness for ${site.domain}`)
      const volumes = await fetchKeywordVolumes(cluster, ctx.country ?? 'it')
      // A brand nobody searches for is a real 0 here — the measurement
      // succeeded, the answer is just zero. That is not the same as a
      // failure, which throws above and leaves raw null.
      const total = volumes.reduce((sum, v) => sum + (Number.isFinite(v.volume) ? v.volume : 0), 0)

      return {
        site_ref: site.site_ref,
        domain: site.domain,
        raw: total,
        evidence: {
          brand_cluster: cluster,
          per_keyword: volumes,
          total_volume: total,
          endpoint: 'ahrefs:keywords-explorer/overview',
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
      source: 'ahrefs:keywords-explorer/overview',
      unmeasured: ctx.sites
        .filter((s) => !sites.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      errors,
    },
  }
}
