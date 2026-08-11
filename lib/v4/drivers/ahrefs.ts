/**
 * V4 — Ahrefs source module.
 *
 * The V1 client (lib/seo-apis/ahrefs) is reused where the shape fits
 * (domain-rating for Authority), but Discoverability and Awareness need
 * responses V1 never asked for: the domain's organic keywords filtered
 * SERVER-SIDE per the Drivers Bibbia sheet 8c.
 *
 * Why server-side (`where`) and not client-side filtering: Ahrefs charges
 * ~13 units per returned row when `volume` is referenced, and gates the
 * request up front on limit × cost. Fetching the unfiltered list and
 * filtering locally would (a) blow the unit budget and (b) on a large site
 * return the top `limit` rows of the WRONG set — the qualifying keywords
 * beyond that window would be silently missed. The `limit` cap is the cost
 * lever (Bibbia: tunable, currently 1000).
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

/** One clause of an Ahrefs v3 `where` filter. */
type WhereClause =
  | { field: string; is: [string, ...unknown[]] }
  | { and: WhereClause[] }
  | { or: WhereClause[] }

export interface OrganicKeyword {
  keyword: string
  volume: number
  position: number
}

function parseKeywordRows(
  body: Record<string, unknown>,
  what: string,
): OrganicKeyword[] {
  const rows = (body.keywords ?? body.organic_keywords ?? body.rows ?? []) as Array<
    Record<string, unknown>
  >
  if (!Array.isArray(rows)) {
    throw new DriverSourceError(`${what} — unexpected Ahrefs payload (no keyword list)`)
  }
  return rows.map((r) => ({
    keyword: String(r.keyword ?? ''),
    volume: Number(r.volume ?? 0),
    position: Number(r.best_position ?? r.position ?? 0),
  }))
}

/**
 * The domain's organic keywords, filtered SERVER-SIDE.
 *
 * Shared low-level call for Discoverability and Awareness — same endpoint,
 * inverse filters (Bibbia 8c: no-brand quality count vs branded demand).
 *
 * `date` is the frozen REF_DATE of the run: every site of the set must be
 * measured on the same day, otherwise the leader index compares snapshots
 * taken at different times.
 */
export async function fetchOrganicKeywords(
  domain: string,
  country: string,
  date: string | null,
  opts: {
    where: WhereClause
    what: string
    limit?: number
  },
): Promise<OrganicKeyword[]> {
  const params = new URLSearchParams({
    target: domain,
    mode: 'subdomains',
    country: (country || 'it').toLowerCase(),
    select: 'keyword,volume,best_position',
    order_by: 'volume:desc',
    limit: String(opts.limit ?? 1000),
    where: JSON.stringify(opts.where),
    output: 'json',
  })
  if (date) params.set('date', date)

  const body = await ahrefsGet(
    `/site-explorer/organic-keywords?${params.toString()}`,
    opts.what,
  )
  return parseKeywordRows(body, opts.what)
}

/**
 * Discoverability (Bibbia 8c): NON-BRAND keywords inside the active tier —
 * `is_branded=false AND best_position<=pos AND volume>=vol`. Raw = row count.
 */
export function tierWhere(pos: number, vol: number): WhereClause {
  return {
    and: [
      { field: 'is_branded', is: ['eq', false] },
      { field: 'best_position', is: ['lte', pos] },
      { field: 'volume', is: ['gte', vol] },
    ],
  }
}

/**
 * Awareness (Bibbia 8c, domain-grounded): the domain's own keywords in the
 * top 100 that CONTAIN a brand term. The inverse of the Discoverability
 * filter — never `is_branded=true` alone (it marks ANY brand, e.g. the boat
 * brands a dealer sells, not the site's own brand).
 */
export function brandedWhere(brandTerms: string[]): WhereClause {
  return {
    and: [
      { field: 'best_position', is: ['lte', 100] },
      { or: brandTerms.map((t) => ({ field: 'keyword', is: ['isubstring', t] as [string, ...unknown[]] })) },
    ],
  }
}
