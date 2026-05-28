/**
 * Schema Radiography — extraction.
 *
 * Pulls JSON-LD blocks and OpenGraph meta tags out of a rendered HTML payload
 * (Firecrawl output). No DOM dependency — regex is enough for these tags
 * because they are tightly delimited.
 */

export interface SchemaBlock {
  /** Canonical schema.org `@type` of this block (first one if an array). */
  type: string
  /** Top-level keys present on the JSON-LD object (excluding @-prefixed). */
  properties: string[]
  /** The original JSON object as parsed. */
  raw: Record<string, unknown>
  /** URL of the page where the block was found. */
  pageUrl: string
}

export interface OpenGraphTags {
  pageUrl: string
  /** og:title, og:description, og:image, og:url, og:type, og:site_name + twitter:* */
  tags: Record<string, string>
}

/**
 * Pull all `<script type="application/ld+json">…</script>` blocks. Returns the
 * raw text payloads — parsing/normalization is the caller's job.
 *
 * The regex is intentionally permissive: it accepts single or double quotes
 * around `type`, optional whitespace around `=`, and extra parameters on the
 * media type itself (e.g. `application/ld+json; charset=utf-8`, which a lot
 * of CMS templates emit). Real-world sites get these wrong constantly — a
 * stricter match silently drops valid JSON-LD.
 */
export function extractJsonLdScripts(html: string): string[] {
  const out: string[] = []
  const re = /<script\b[^>]*?\btype\s*=\s*["']?\s*application\/ld\+json\b[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const inner = m[1]
    if (inner && inner.trim().length > 0) out.push(inner.trim())
  }
  return out
}

/**
 * Parse a JSON-LD script payload into one or more schema blocks. Handles three
 * common shapes: bare object, array of objects, or a single object with
 * `@graph` containing the actual blocks.
 */
export function parseJsonLdPayload(
  text: string,
  pageUrl: string,
): SchemaBlock[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Some sites publish JSON-LD with trailing commas or HTML entities. Try a
    // cheap recovery pass before giving up.
    const sanitized = text
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/,\s*([}\]])/g, '$1')
    try {
      parsed = JSON.parse(sanitized)
    } catch {
      return []
    }
  }

  const blocks: SchemaBlock[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    const obj = node as Record<string, unknown>
    if ('@graph' in obj && Array.isArray(obj['@graph'])) {
      for (const child of obj['@graph'] as unknown[]) walk(child)
      // The wrapper object itself rarely has its own @type; skip.
      if (!obj['@type']) return
    }
    const rawType = obj['@type']
    const typeStr = Array.isArray(rawType)
      ? typeof rawType[0] === 'string' ? (rawType[0] as string) : ''
      : typeof rawType === 'string' ? rawType : ''
    if (!typeStr) return
    const properties = Object.keys(obj).filter(k => !k.startsWith('@'))
    blocks.push({
      type: typeStr,
      properties,
      raw: obj,
      pageUrl,
    })
  }
  walk(parsed)
  return blocks
}

/** Convenience: extract + parse all JSON-LD on a page. */
export function extractSchemaBlocks(html: string, pageUrl: string): SchemaBlock[] {
  const payloads = extractJsonLdScripts(html)
  const blocks: SchemaBlock[] = []
  for (const p of payloads) {
    for (const b of parseJsonLdPayload(p, pageUrl)) blocks.push(b)
  }
  return blocks
}

/**
 * Pull OpenGraph + Twitter Card meta tags. Returns a flat map of
 * `og:title` / `twitter:card` / etc → value.
 */
export function extractOpenGraph(html: string, pageUrl: string): OpenGraphTags {
  const tags: Record<string, string> = {}
  // <meta property="og:foo" content="bar">  OR  <meta name="og:foo" content="bar">
  const re = /<meta\b[^>]*?(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["'][^>]*?content=["']([^"']*)["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const key = m[1].toLowerCase()
    const val = decodeHtmlEntities(m[2])
    if (val && !tags[key]) tags[key] = val
  }
  // Some sites put content before property — handle that variant too.
  const reReverse = /<meta\b[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["'][^>]*>/gi
  while ((m = reReverse.exec(html)) !== null) {
    const key = m[2].toLowerCase()
    const val = decodeHtmlEntities(m[1])
    if (val && !tags[key]) tags[key] = val
  }
  return { pageUrl, tags }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/**
 * Best-effort: is this property "present and non-empty" on a JSON-LD block?
 * A property counts as present when its value is:
 *   - a non-empty string
 *   - a number or boolean
 *   - a non-empty array
 *   - an object with at least one populated key (or just `@id`/`@type` reference)
 */
export function isPropertyPresent(
  raw: Record<string, unknown>,
  key: string,
): boolean {
  if (!(key in raw)) return false
  const v = raw[key]
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (typeof v === 'number' || typeof v === 'boolean') return true
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    return Object.keys(obj).length > 0
  }
  return false
}
