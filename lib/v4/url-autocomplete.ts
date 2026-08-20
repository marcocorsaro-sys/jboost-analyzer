/**
 * V4 setup wizard — pure ranking logic for the template-URL autocomplete.
 *
 * The wizard shows a type-ahead dropdown over the site's real sitemap URLs
 * (GET /api/v4/analyses/sitemap-urls). This module owns the part that is
 * worth testing without a browser: given the sitemap entries, the text the
 * analyst typed and the template being filled, which 8 URLs to propose and
 * in which order.
 */

/** One sitemap entry as returned by /api/v4/analyses/sitemap-urls. */
export interface SitemapUrlEntry {
  url: string
  /** Page role inferred by lib/schema/discover (product, category, blog, …). */
  role: string
}

/** Max entries the dropdown shows — more is noise, the analyst can keep typing. */
export const AUTOCOMPLETE_LIMIT = 8

/** Same bare-domain shape the wizard normalizes to ('benetton.com'). */
export const BARE_DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/

export function isBareDomain(value: string): boolean {
  return BARE_DOMAIN_RE.test(value)
}

/**
 * template_key (lib/v4/setup TEMPLATE_KEYS) → sitemap page roles that most
 * likely belong to that template. 'global' is intentionally absent: any URL
 * fits it. Unknown keys degrade the same way (no role priority, length only).
 */
const TEMPLATE_ROLES: Record<string, readonly string[]> = {
  homepage: ['homepage'],
  pdp: ['product'],
  plp: ['category'],
  article: ['article', 'blog', 'news'],
  listing_articles: ['blog', 'listing'],
  faq: ['faq'],
  about: ['about'],
  service_page: ['service'],
}

/**
 * Filter + rank the sitemap URLs for one autocomplete dropdown.
 *
 *  - filter: case-insensitive substring on `query` (empty query keeps all);
 *  - order: URLs whose role matches the template first, then shorter URLs
 *    (short URLs are more likely the representative example of a template),
 *    then alphabetical for determinism;
 *  - cap: AUTOCOMPLETE_LIMIT results.
 */
export function rankSitemapUrls(
  urls: SitemapUrlEntry[],
  opts: { query: string; templateKey: string },
): SitemapUrlEntry[] {
  const q = opts.query.trim().toLowerCase()
  const preferredRoles = TEMPLATE_ROLES[opts.templateKey]
  const filtered = q === '' ? urls : urls.filter((u) => u.url.toLowerCase().includes(q))
  const roleRank = (u: SitemapUrlEntry) =>
    preferredRoles === undefined || preferredRoles.includes(u.role) ? 0 : 1
  return [...filtered]
    .sort(
      (a, b) =>
        roleRank(a) - roleRank(b) ||
        a.url.length - b.url.length ||
        a.url.localeCompare(b.url),
    )
    .slice(0, AUTOCOMPLETE_LIMIT)
}
