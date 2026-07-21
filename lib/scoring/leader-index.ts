/**
 * V4 scoring core — LEADER-INDEX normalization.
 *
 * Implements SCORING_SPEC.md as crystallized in the Drivers Bibbia (03),
 * sheet 8 "Normalization Model" and sheet 8b "API & Scoring Framework".
 *
 * One model governs ALL 10 drivers: each raw value is expressed as a
 * percentage of the set leader (max = 100). Linear by default,
 * logarithmic (log10) for high-dispersion drivers (today only Traffic).
 *
 * Rules (sheet 8, section A + edge rules):
 *  - leader = max(non-null raw of the set)
 *  - linear:      score = round(100 * raw / leader, 1)
 *  - logarithmic: score = round(100 * log10(raw) / log10(leader), 1)
 *  - raw = null            -> score = null, EXCLUDED from overall (not 0)
 *  - leader <= 0           -> all scores 0.0
 *  - log with raw <= 1
 *    or leader <= 1        -> 0.0 (log undefined/negative)
 *  - a measured positive raw under linear/log is never 0
 *  - NO artificial floor (the earlier "floor 1 / clamp [1,100]" wording
 *    is superseded — sheet 8 section G)
 *
 * Aggregation (sheet 8, section D):
 *  - overall(site) = round(sum(w_d * score_d) / sum(w_d), 1) over
 *    drivers with score != null
 *  - rank: per driver and overall, descending, 1 = best, nulls excluded
 *
 * This module is pure and framework-free: it can be unit-tested against
 * the worked examples of sheet 8 and reused by workers, API routes and
 * the results UI alike.
 */

export type NormalizationMode = 'linear' | 'logarithmic'

export interface ScoringSiteInput {
  /** Display name ("Cliente", "Competitor 1"...). */
  name: string
  /** Bare domain: no protocol, no www., lowercase (sheet 8b conventions). */
  domain: string
  is_client: boolean
  /** driver_key -> raw value (null = missing / not measured). */
  raw: Record<string, number | null>
}

export interface ScoringInput {
  /** Driver keys participating in this analysis (enabled drivers). */
  drivers: string[]
  /** Subset of `drivers` normalized logarithmically (today: ['traffic']). */
  log_drivers?: string[]
  /** Optional per-driver weight override; default 1.0 (sheet 8 section D). */
  weights?: Record<string, number>
  sites: ScoringSiteInput[]
}

export interface ScoringSiteOutput {
  name: string
  domain: string
  is_client: boolean
  /** driver_key -> leader-index score 0-100 (1 decimal) or null. */
  scores: Record<string, number | null>
  overall: number | null
  /** driver_key -> rank (1 = best) or null when score is null. */
  rank: Record<string, number | null>
  overall_rank: number | null
}

export interface DriverLeaderInfo {
  /** Domain of the set leader for this driver (null if no measurable value). */
  leader_domain: string | null
  leader_raw: number | null
  mode: NormalizationMode
}

export interface ScoringOutput {
  sites: ScoringSiteOutput[]
  /** Per-driver leader metadata, for "leader badge" UI and traceability. */
  leaders: Record<string, DriverLeaderInfo>
  /**
   * Audit rows pairing, per site and driver, raw | score | rank
   * (sheet 8 section E: "so every score is traceable to its raw").
   */
  audit: Array<{
    domain: string
    driver: string
    raw: number | null
    score: number | null
    rank: number | null
  }>
}

/** round(x, 1) with epsilon correction against FP artifacts. */
export function round1(x: number): number {
  return Math.round((x + Number.EPSILON) * 10) / 10
}

/**
 * Normalize one driver's raw values across the analyzed set.
 * Exposed for per-driver use (e.g. recompute after a single edit).
 */
export function leaderIndex(
  raws: Array<number | null>,
  mode: NormalizationMode = 'linear',
): Array<number | null> {
  const measurable = raws.filter((v): v is number => v !== null && Number.isFinite(v))
  if (measurable.length === 0) return raws.map(() => null)

  const leader = Math.max(...measurable)

  return raws.map((raw) => {
    if (raw === null || !Number.isFinite(raw)) return null
    // Edge: leader <= 0 -> all scores 0.0 (sheet 8 edge rules)
    if (leader <= 0) return 0.0
    if (mode === 'logarithmic') {
      // Edge: log variant with raw <= 1 or leader <= 1 -> 0.0
      if (raw <= 1 || leader <= 1) return 0.0
      return round1((100 * Math.log10(raw)) / Math.log10(leader))
    }
    const score = round1((100 * raw) / leader)
    // "A measured positive value is never 0" (sheet 8, repeated per driver).
    // Not an artificial scoring floor (superseded, section G): only a
    // rounding guard so a tiny-but-measured raw stays distinguishable
    // from zero/absent at 1-decimal precision.
    if (score === 0 && raw > 0) return 0.1
    return score
  })
}

/** Competition ranking (1,2,2,4) over scores, descending; null -> null. */
function rankDescending(scores: Array<number | null>): Array<number | null> {
  const sorted = scores
    .filter((s): s is number => s !== null)
    .sort((a, b) => b - a)
  return scores.map((s) => (s === null ? null : sorted.indexOf(s) + 1))
}

/**
 * Full-set scoring: normalize every driver, aggregate overall, rank.
 * Input/output shapes match the data contracts of sheet 8 section E.
 */
export function scoreSet(input: ScoringInput): ScoringOutput {
  const { drivers, sites } = input
  const logDrivers = new Set(input.log_drivers ?? [])
  const weights = input.weights ?? {}

  // --- per-driver normalization ---------------------------------------
  const perDriverScores: Record<string, Array<number | null>> = {}
  const leaders: Record<string, DriverLeaderInfo> = {}

  for (const driver of drivers) {
    const raws = sites.map((s) => {
      const v = s.raw[driver]
      return v === null || v === undefined || !Number.isFinite(v) ? null : v
    })
    const mode: NormalizationMode = logDrivers.has(driver) ? 'logarithmic' : 'linear'
    perDriverScores[driver] = leaderIndex(raws, mode)

    const measurable = raws
      .map((raw, i) => ({ raw, domain: sites[i].domain }))
      .filter((x): x is { raw: number; domain: string } => x.raw !== null)
    if (measurable.length === 0) {
      leaders[driver] = { leader_domain: null, leader_raw: null, mode }
    } else {
      const top = measurable.reduce((a, b) => (b.raw > a.raw ? b : a))
      leaders[driver] = { leader_domain: top.domain, leader_raw: top.raw, mode }
    }
  }

  // --- per-driver ranks ------------------------------------------------
  const perDriverRanks: Record<string, Array<number | null>> = {}
  for (const driver of drivers) {
    perDriverRanks[driver] = rankDescending(perDriverScores[driver])
  }

  // --- overall (weighted mean over non-null scores) --------------------
  const overalls: Array<number | null> = sites.map((_, i) => {
    let num = 0
    let den = 0
    for (const driver of drivers) {
      const score = perDriverScores[driver][i]
      if (score === null) continue // null EXCLUDED, not 0
      const w = weights[driver] ?? 1.0
      num += w * score
      den += w
    }
    return den > 0 ? round1(num / den) : null
  })
  const overallRanks = rankDescending(overalls)

  // --- assemble --------------------------------------------------------
  const outSites: ScoringSiteOutput[] = sites.map((site, i) => {
    const scores: Record<string, number | null> = {}
    const rank: Record<string, number | null> = {}
    for (const driver of drivers) {
      scores[driver] = perDriverScores[driver][i]
      rank[driver] = perDriverRanks[driver][i]
    }
    return {
      name: site.name,
      domain: site.domain,
      is_client: site.is_client,
      scores,
      overall: overalls[i],
      rank,
      overall_rank: overallRanks[i],
    }
  })

  const audit: ScoringOutput['audit'] = []
  for (const driver of drivers) {
    sites.forEach((site, i) => {
      audit.push({
        domain: site.domain,
        driver,
        raw: site.raw[driver] ?? null,
        score: perDriverScores[driver][i],
        rank: perDriverRanks[driver][i],
      })
    })
  }

  return { sites: outSites, leaders, audit }
}

/**
 * Gap vs leader as a signed % chip (UX-UI Bibbia: "the client's gap vs
 * leader is shown as a signed % chip"). score 47.2 -> -52.8.
 */
export function gapVsLeaderPct(score: number | null): number | null {
  if (score === null) return null
  return round1(score - 100)
}
