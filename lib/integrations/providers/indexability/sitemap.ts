/**
 * sitemap.xml parser — leggero, regex-based.
 *
 * Gestisce due forme:
 *   1. urlset (sitemap diretta): <urlset><url><loc>...</loc></url>...</urlset>
 *   2. sitemapindex: <sitemapindex><sitemap><loc>...</loc></sitemap>...</sitemapindex>
 *
 * Per pre-sales ci interessa principalmente il **count totale di URL** e
 * un **sample** delle prime 50 URL per debug. Non scarichiamo ricorsivamente
 * le sub-sitemap di un sitemapindex (potrebbero essere centinaia di MB);
 * raccogliamo solo i loro URL e li riportiamo come "sub-sitemap discovered".
 */

export interface SitemapParsed {
  /** True se il documento è un sitemap XML valido (urlset o sitemapindex). */
  found: boolean
  /** 'urlset' = lista di URL, 'index' = lista di sub-sitemap. */
  kind: 'urlset' | 'index' | 'unknown'
  /** Tutte le <loc> trovate. Per urlset = URL della pagine, per index = URL delle sub-sitemap. */
  locs: string[]
  /** Conteggio URLs (== locs.length per ora; ricorsione disabilitata di default). */
  urlCount: number
  /** Sample delle prime 50 location, già normalizzate. */
  sample: string[]
}

export function parseSitemap(raw: string): SitemapParsed {
  if (!raw || !raw.trim()) {
    return { found: false, kind: 'unknown', locs: [], urlCount: 0, sample: [] }
  }

  const isIndex = /<sitemapindex\b/i.test(raw)
  const isUrlset = /<urlset\b/i.test(raw)
  if (!isIndex && !isUrlset) {
    return { found: false, kind: 'unknown', locs: [], urlCount: 0, sample: [] }
  }

  // <loc>...</loc> robusti contro spazi e CDATA
  const locRe = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi
  const locs: string[] = []
  let m: RegExpExecArray | null
  while ((m = locRe.exec(raw)) !== null) {
    const u = m[1].trim()
    if (u) locs.push(u)
  }

  return {
    found: true,
    kind: isIndex ? 'index' : 'urlset',
    locs,
    urlCount: locs.length,
    sample: locs.slice(0, 50),
  }
}
