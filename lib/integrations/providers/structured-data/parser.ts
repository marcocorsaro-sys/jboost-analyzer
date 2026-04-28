/**
 * Structured Data parser — estrae e analizza JSON-LD da HTML.
 *
 * Schema.org coverage assessment: per ogni `<script type="application/ld+json">`
 * blocco, parsa JSON e raccoglie i `@type` presenti. Restituisce stat aggregate
 * usabili per il driver SEO + report pre-sales.
 *
 * Niente DOM parser (pesi e overhead): regex sull'HTML grezzo. Per i siti
 * standard (HubSpot, WordPress, Shopify, ecc.) funziona benissimo.
 */

export interface JsonLdBlock {
  /** Posizione nell'HTML (per debug). */
  index: number
  /** Tipi Schema.org dichiarati nel blocco (può essere multi-type). */
  types: string[]
  /** True se il JSON era ben formato. */
  parsed: boolean
  /** Errore parse, se non `parsed`. */
  error?: string
  /** Payload deserializzato, se `parsed`. */
  data?: unknown
  /** Lunghezza raw del blocco in caratteri (cap a 500 byte per il summary). */
  rawSize: number
}

export interface StructuredDataPageReport {
  url: string
  blocks: JsonLdBlock[]
  /** Set ordinato di tutti i @type trovati nella pagina. */
  typesPresent: string[]
  /** Numero di blocchi con almeno 1 errore di parsing. */
  parseErrors: number
}

/**
 * Estrai e parsa tutti i blocchi `<script type="application/ld+json">`
 * presenti nell'HTML di una pagina.
 */
export function parseJsonLdBlocks(html: string): JsonLdBlock[] {
  const blocks: JsonLdBlock[] = []
  // Match <script type="application/ld+json">...</script>, content-greedy
  // ma su singola pagina è OK perché di solito ci sono <10 blocchi.
  const re = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? '').trim()
    const block: JsonLdBlock = {
      index: i++,
      types: [],
      parsed: false,
      rawSize: raw.length,
    }
    if (raw.length === 0) {
      block.error = 'empty'
      blocks.push(block)
      continue
    }
    try {
      // I JSON-LD spesso hanno HTML entities scappate (&amp;, &quot;, ecc.):
      // unescape minimale per i casi più comuni.
      const cleaned = raw
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
      const parsed = JSON.parse(cleaned)
      block.parsed = true
      block.data = parsed
      block.types = extractTypes(parsed)
    } catch (err) {
      block.error = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)
    }
    blocks.push(block)
  }
  return blocks
}

export function buildPageReport(url: string, html: string): StructuredDataPageReport {
  const blocks = parseJsonLdBlocks(html)
  const allTypes = new Set<string>()
  for (const b of blocks) for (const t of b.types) allTypes.add(t)
  return {
    url,
    blocks,
    typesPresent: Array.from(allTypes).sort(),
    parseErrors: blocks.filter((b) => !b.parsed).length,
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Estrai i `@type` da un payload JSON-LD. Gestisce:
 *   - Singolo oggetto: { "@type": "Organization", ... }
 *   - Multi-type: { "@type": ["Organization", "Corporation"], ... }
 *   - Array root: [{ "@type": "..." }, { "@type": "..." }]
 *   - @graph nested: { "@graph": [{ "@type": "..." }, ...] }
 */
function extractTypes(data: unknown): string[] {
  const types = new Set<string>()
  walk(data, types)
  return Array.from(types).sort()
}

function walk(node: unknown, acc: Set<string>): void {
  if (!node) return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, acc)
    return
  }
  if (typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  const t = obj['@type']
  if (typeof t === 'string') acc.add(t)
  else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') acc.add(x)
  // Recurse in @graph
  const graph = obj['@graph']
  if (Array.isArray(graph)) for (const g of graph) walk(g, acc)
  // Niente recursione profonda generica per evitare overcounting di nested.
}

// -------------------------------------------------------------------------
// Schema.org coverage scoring
// -------------------------------------------------------------------------

/**
 * I tipi Schema.org "core" che ci aspettiamo su un sito ben curato.
 * Pesi proporzionali al valore SEO: Organization è il minimo; FAQ/HowTo/Product
 * sono content-rich e contribuiscono a Featured Snippet eligibility e AI Overview.
 */
const CORE_TYPES_WEIGHTS: Record<string, number> = {
  // Identity / brand
  Organization: 10,
  Corporation: 8,
  LocalBusiness: 12,
  WebSite: 8,
  WebPage: 6,
  // Navigation / structure
  BreadcrumbList: 8,
  SiteNavigationElement: 5,
  // Content-rich (boost AI Overview eligibility)
  Article: 10,
  NewsArticle: 10,
  BlogPosting: 8,
  FAQPage: 12,
  HowTo: 12,
  Question: 6,
  // Commerce
  Product: 10,
  Offer: 6,
  Review: 8,
  AggregateRating: 6,
  // People
  Person: 5,
  // Multimedia
  ImageObject: 4,
  VideoObject: 6,
  // Events
  Event: 6,
}

const MAX_SCORE = Object.values(CORE_TYPES_WEIGHTS).reduce((a, b) => a + b, 0)

export interface SchemaCoverageScore {
  score: number // 0..100
  presentTypes: string[]
  missingHighValueTypes: string[]
}

/**
 * Calcola un coverage score 0..100 in base ai tipi Schema.org presenti.
 * Non è uno score "qualità" (non controllo che i campi obbligatori siano
 * presenti — è solo "presence"), ma è una buona stima per pre-sales.
 */
export function computeSchemaCoverageScore(typesPresent: string[]): SchemaCoverageScore {
  const present = new Set(typesPresent)
  let weight = 0
  for (const [t, w] of Object.entries(CORE_TYPES_WEIGHTS)) {
    if (present.has(t)) weight += w
  }
  const score = Math.round((weight / MAX_SCORE) * 100)
  // Highlight di tipi a valore alto NON presenti (>= 8 di peso)
  const missingHighValueTypes: string[] = []
  for (const [t, w] of Object.entries(CORE_TYPES_WEIGHTS)) {
    if (w >= 8 && !present.has(t)) missingHighValueTypes.push(t)
  }
  return {
    score: Math.min(100, score),
    presentTypes: typesPresent,
    missingHighValueTypes,
  }
}
