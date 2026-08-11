/**
 * V4 driver — Discoverability.
 *
 * Source: Ahrefs organic keywords (single source, no fallback).
 * Raw: how many keywords the domain ranks for inside the active tier.
 * Relative only — a keyword count means nothing without the set to compare it
 * to, which is why this is a Business driver and needs a competitor.
 *
 * The tier cascade (registry DISCO_TIERS) exists because a strict tier can
 * legitimately return zero for a small player. The cascade is NEVER applied
 * automatically: relaxing the tier for one site and not the others would
 * compare different things, and relaxing it for everybody changes what the
 * whole driver measures. So an empty player pauses the job on
 * needs_decision and the analyst chooses — remove the player, replace it, or
 * extend the tier for the entire set.
 */

import { DISCO_TIERS, type DiscoTierKey } from '@/lib/scoring/registry'
import { fetchOrganicKeywords, tierWhere, type OrganicKeyword } from './ahrefs'
import type { AnalysisSite, DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { assertDeadline, mapPool } from './source'

export interface TierRule {
  key: DiscoTierKey
  /** Keyword counts only if the domain ranks at this position or better. */
  pos: number
  /** …and the keyword has at least this monthly search volume. */
  vol: number
}

export function tierRule(key: DiscoTierKey): TierRule {
  const found = DISCO_TIERS.find((t) => t.key === key)
  if (!found) throw new Error(`unknown Discoverability tier "${key}"`)
  return { key: found.key, pos: found.pos, vol: found.vol }
}

/**
 * Pure: which keywords qualify at the given tier.
 *
 * The tier filter is ALSO applied server-side (tierWhere in the Ahrefs
 * `where` param — the cost lever, ~13 units/row gated on limit × cost).
 * This local re-check is belt and braces: it keeps the counting rule
 * testable without the network and guards against a provider ignoring or
 * loosening the filter.
 */
export function countAtTier(keywords: OrganicKeyword[], rule: TierRule): OrganicKeyword[] {
  return keywords.filter((k) => k.position <= rule.pos && k.volume >= rule.vol)
}

/**
 * Bibbia decision 2026-06-22 (no-brand filter): besides `is_branded=false`
 * server-side, strip anything containing the site's own brand name or the
 * manually entered variants — `is_branded` flags ANY brand, so the site's
 * own brand terms are the part it can miss.
 */
export function stripBrandTerms(
  keywords: OrganicKeyword[],
  site: AnalysisSite,
): OrganicKeyword[] {
  const terms = [site.brand_name ?? '', ...(site.brand_variants ?? [])]
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (terms.length === 0) return keywords
  return keywords.filter((k) => {
    const kw = k.keyword.toLowerCase()
    return !terms.some((t) => kw.includes(t))
  })
}

/** The tier the analyst extended to, or the strict default. */
export function activeTier(decisionTaken: Record<string, unknown> | null | undefined): DiscoTierKey {
  const chosen = decisionTaken?.tier
  if (typeof chosen === 'string' && DISCO_TIERS.some((t) => t.key === chosen)) {
    return chosen as DiscoTierKey
  }
  return 'strict'
}

/** The next looser tier, or null when there is nothing left to relax. */
export function nextTier(current: DiscoTierKey): DiscoTierKey | null {
  const i = DISCO_TIERS.findIndex((t) => t.key === current)
  return i >= 0 && i < DISCO_TIERS.length - 1 ? DISCO_TIERS[i + 1].key : null
}

export const discoverabilityWorker: DriverWorker = async (ctx) => {
  const errors: string[] = []
  const tier = tierRule(activeTier(ctx.decisionTaken))

  // Domains the analyst already decided to drop on a previous pause.
  const removed = new Set(
    Array.isArray(ctx.decisionTaken?.removed) ? (ctx.decisionTaken!.removed as string[]) : [],
  )
  const targets = ctx.sites.filter((s) => !removed.has(s.domain))

  const measured = await mapPool(targets, 3, async (site) => {
    try {
      assertDeadline(ctx.deadlineAt, `Discoverability for ${site.domain}`)
      const keywords = await fetchOrganicKeywords(site.domain, ctx.country ?? 'it', ctx.refDate, {
        where: tierWhere(tier.pos, tier.vol),
        what: `Discoverability for ${site.domain}`,
      })
      const qualifying = stripBrandTerms(countAtTier(keywords, tier), site)
      return { site, keywords, qualifying }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
      return null
    }
  })

  const ok = measured.filter((m): m is NonNullable<typeof m> => m !== null)

  const clientRef = ctx.sites.find((s) => s.is_client)?.site_ref
  if (!ok.some((m) => m.site.site_ref === clientRef)) {
    return {
      status: 'error',
      error: `Discoverability could not be measured for the client site. ${
        errors.join(' | ') || 'no reason reported'
      }`,
      rawPayload: { tier: tier.key, errors },
    }
  }

  // An empty player is not a zero: at a strict tier it usually means the tier
  // is wrong for this set, not that the site is invisible.
  const emptyPlayers = ok.filter((m) => m.qualifying.length === 0).map((m) => m.site.domain)
  if (emptyPlayers.length > 0) {
    const suggestion = nextTier(tier.key)
    return {
      status: 'needs_decision',
      decisionRequest: {
        reason: 'empty_tier',
        tier: tier.key,
        tier_rule: { position_max: tier.pos, volume_min: tier.vol },
        empty_players: emptyPlayers,
        options: suggestion ? ['remove', 'replace', 'extend'] : ['remove', 'replace'],
        next_tier: suggestion,
        message:
          `${emptyPlayers.join(', ')} non ha keyword nel tier "${tier.key}" ` +
          `(posizione <= ${tier.pos}, volume >= ${tier.vol}). ` +
          'Estendere il tier vale per TUTTO il set: misurare i siti a tier diversi ' +
          'confronterebbe cose diverse.',
      },
      rawPayload: {
        tier: tier.key,
        counts: ok.map((m) => ({ domain: m.site.domain, qualifying: m.qualifying.length })),
        errors,
      },
    }
  }

  const sites: SiteRawValue[] = ok.map((m) => ({
    site_ref: m.site.site_ref,
    domain: m.site.domain,
    raw: m.qualifying.length,
    evidence: {
      tier: tier.key,
      tier_rule: { position_max: tier.pos, volume_min: tier.vol },
      keywords_in_tier: m.qualifying.length,
      keywords_scanned: m.keywords.length,
      top_keywords: m.qualifying
        .slice()
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 10),
      endpoint: 'ahrefs:site-explorer/organic-keywords',
    },
  }))

  return {
    status: 'done',
    sites,
    tierUsed: tier.key,
    rawPayload: {
      source: 'ahrefs:site-explorer/organic-keywords',
      tier: tier.key,
      removed_by_analyst: [...removed],
      unmeasured: ctx.sites
        .filter((s) => !sites.some((m) => m.site_ref === s.site_ref))
        .map((s) => s.domain),
      errors,
    },
  }
}
