/**
 * robots.txt parser — molto leggero, copre il subset rilevante per il
 * pre-sales audit: User-agent blocks, Disallow/Allow rules, Sitemap directives.
 *
 * Non fa enforcement né testing di URL specifici (quello richiede un
 * matcher full come `robots-parser`). Per ora ci basta:
 *   - elenco delle User-agent group con relativi Disallow
 *   - elenco delle Sitemap URLs dichiarate
 *   - rilevamento di "Disallow: /" globale (sito completamente bloccato)
 *
 * Spec di riferimento: https://www.rfc-editor.org/rfc/rfc9309
 */

export interface RobotsRule {
  type: 'allow' | 'disallow'
  path: string
}

export interface RobotsUserAgentBlock {
  /** User-agent target (es. '*', 'Googlebot', 'Bingbot'). */
  agent: string
  rules: RobotsRule[]
}

export interface RobotsParsed {
  /** True se il fetch ha trovato una robots.txt valida. */
  found: boolean
  raw: string
  blocks: RobotsUserAgentBlock[]
  sitemaps: string[]
  /** Convenience: il sito blocca esplicitamente Googlebot o '*' su `/`? */
  blocksAllCrawl: boolean
  /** Errore di fetch / parse (se any). */
  error?: string
}

export function parseRobots(raw: string): RobotsParsed {
  if (!raw || !raw.trim()) {
    return {
      found: false,
      raw: raw ?? '',
      blocks: [],
      sitemaps: [],
      blocksAllCrawl: false,
    }
  }

  const lines = raw.split(/\r?\n/)
  const blocks: RobotsUserAgentBlock[] = []
  const sitemaps: string[] = []
  let currentBlock: RobotsUserAgentBlock | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const directive = line.slice(0, colonIdx).trim().toLowerCase()
    const value = line.slice(colonIdx + 1).trim()

    if (directive === 'sitemap') {
      if (value) sitemaps.push(value)
      continue
    }
    if (directive === 'user-agent') {
      // Apri un nuovo block (o accoda al corrente se più User-agent in fila)
      if (!currentBlock || currentBlock.rules.length > 0) {
        currentBlock = { agent: value, rules: [] }
        blocks.push(currentBlock)
      } else {
        // multi-agent group senza rules tra mezzo: stesso block, agent multipli
        // Per semplicità manteniamo solo l'ultimo agent dichiarato come label
        currentBlock.agent = value
      }
      continue
    }
    if (directive === 'disallow' || directive === 'allow') {
      if (!currentBlock) continue
      currentBlock.rules.push({ type: directive, path: value })
    }
    // Crawl-delay, host, ecc. → ignorati per ora
  }

  // Detection "site completamente bloccato": Disallow: / su user-agent '*'
  // o 'Googlebot'.
  const targetAgents = ['*', 'Googlebot']
  const blocksAllCrawl = blocks.some(
    (b) =>
      targetAgents.includes(b.agent) &&
      b.rules.some((r) => r.type === 'disallow' && r.path === '/'),
  )

  return {
    found: true,
    raw,
    blocks,
    sitemaps,
    blocksAllCrawl,
  }
}
