/**
 * V4 — Ahrefs source module.
 *
 * The V1 client (lib/seo-apis/ahrefs) is reused where the shape fits
 * (domain-rating for Authority), but Discoverability and Awareness need
 * responses V1 never asked for: keyword positions with volumes, and a
 * keyword-list volume lookup. Those live here.
 *
 * Every function THROWS on failure. That is the difference from V1, which
 * answers a 403 with a plausible mock and lets a fabricated number reach a
 * score. See lib/v4/drivers/source.ts for the reasoning.
 */

import { DriverSourceError } from './source'

const AHREFS_API_BASE = 'https://api.ahrefs.com/v3'

function apiKey(): string {
  const key = process.env.AHREFS_API_KEY
  if (!key) throw new DriverSourceError('AHREFS_API_KEY is not configured')
  return key
}

async function ahrefsGet(path: string, what: string): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(`${AHREFS_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey()}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    throw new DriverSourceError(
      `${what} — Ahrefs request failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (res.status === 403) {
    throw new DriverSourceError(
      `${what} — Ahrefs answered 403: the API plan does not grant this endpoint. ` +
        'No substitute value is allowed, so the driver is blocked.',
    )
  }
  if (!res.ok) {
    throw new DriverSourceError(`${what} — Ahrefs answered ${res.status}`)
  }

  return (await res.json()) as Record<string, unknown>
}

export interface OrganicKeyword {
  keyword: string
  volume: number
  position: number
}

/**
 * Organic keywords of a domain, with the position and volume the tier
 * cascade filters on.
 *
 * `date` is the frozen REF_DATE of the run: every site of the set must be
 * measured on the same day, otherwise the leader index compares snapshots
 * taken at different times.
 */
export async function fetchOrganicKeywords(
  domain: string,
  country: string,
  date: string | null,
  limit = 1000,
): Promise<OrganicKeyword[]> {
  const params = new URLSearchParams({
    target: domain,
    country: (country || 'it').toLowerCase(),
    select: 'keyword,volume,best_position',
    limit: String(limit),
    output: 'json',
  })
  if (date) params.set('date', date)

  const body = await ahrefsGet(
    `/site-explorer/organic-keywords?${params.toString()}`,
    `Discoverability for ${domain}`,
  )

  const rows = (body.keywords ?? body.organic_keywords ?? body.rows ?? []) as Array<
    Record<string, unknown>
  >
  if (!Array.isArray(rows)) {
    throw new DriverSourceError(
      `Discoverability for ${domain} — unexpected Ahrefs payload (no keyword list)`,
    )
  }

  return rows
    .map((r) => ({
      keyword: String(r.keyword ?? ''),
      volume: Number(r.volume ?? 0),
      position: Number(r.best_position ?? r.position ?? 0),
    }))
    .filter((k) => k.keyword && Number.isFinite(k.position) && k.position > 0)
}

export interface KeywordVolume {
  keyword: string
  volume: number
}

/**
 * Search volume for an explicit keyword list (Awareness brand cluster).
 *
 * Ahrefs answers per keyword; a keyword nobody searches for legitimately has
 * volume 0, which is NOT the same as "we could not measure it" — the latter
 * throws, the former contributes 0 to the brand cluster sum.
 */
export async function fetchKeywordVolumes(
  keywords: string[],
  country: string,
): Promise<KeywordVolume[]> {
  if (keywords.length === 0) return []

  const params = new URLSearchParams({
    keywords: keywords.join(','),
    country: (country || 'it').toLowerCase(),
    select: 'keyword,volume',
    output: 'json',
  })

  const body = await ahrefsGet(
    `/keywords-explorer/overview?${params.toString()}`,
    `Awareness for [${keywords.slice(0, 3).join(', ')}…]`,
  )

  const rows = (body.keywords ?? body.rows ?? []) as Array<Record<string, unknown>>
  if (!Array.isArray(rows)) {
    throw new DriverSourceError('Awareness — unexpected Ahrefs payload (no keyword list)')
  }

  return rows.map((r) => ({
    keyword: String(r.keyword ?? ''),
    volume: Number(r.volume ?? 0),
  }))
}
