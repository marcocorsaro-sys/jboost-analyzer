/**
 * Wappalyzer-style detector engine — applica i fingerprints in
 * `fingerprints.ts` alla pagina scaricata da `WappalyzerClient` e ritorna
 * la lista delle tecnologie riconosciute con confidence + version.
 *
 * Logica di matching:
 *   1. Per ogni fingerprint, controlla i quattro segnali (HTML, header,
 *      script src, meta tag, cookie) e calcola un confidence aggregato:
 *        - ogni signal contribuisce con il proprio peso (max 100)
 *        - se almeno UN signal hits con confidence >= 30, la tecnologia
 *          viene considerata rilevata
 *   2. Estrai script src DA tutti i <script> tag in modo grezzo (regex)
 *      per evitare di parsare DOM full (cheddar / cheerio sono pesanti).
 *   3. Estrai version dalla named group `(?<version>...)` del primo
 *      pattern che la cattura, in ordine: meta > header > script > html.
 */

import type { Fingerprint, FingerprintCategory } from './fingerprints'
import type { FetchPageResult } from './client'
import { FINGERPRINTS } from './fingerprints'

export interface DetectedTech {
  name: string
  category: FingerprintCategory
  website?: string
  iconSlug?: string
  /** 0..100. >= 30 per essere riportata. */
  confidence: number
  /** Stringa di versione catturata, se presente (es. "6.5"). */
  version?: string
  /** Quale signal ha rilevato la tecnologia. Utile per debug. */
  matchedVia: ('html' | 'header' | 'script' | 'meta' | 'cookie')[]
}

const MIN_CONFIDENCE = 30

export function detectFromPage(page: FetchPageResult): DetectedTech[] {
  const html = page.html
  // Estrai una volta sola la lista dei <script src="..."> dell'HTML
  const scriptSrcs = extractScriptSrcs(html)
  // Estrai meta tag in mappa name → content
  const metaTags = extractMetaTags(html)

  const detected: DetectedTech[] = []

  for (const fp of FINGERPRINTS) {
    const result = applyFingerprint(fp, {
      html,
      headers: page.headers,
      scriptSrcs,
      metaTags,
      cookieNames: page.cookieNames,
    })
    if (result && result.confidence >= MIN_CONFIDENCE) {
      detected.push(result)
    }
  }

  // Sort by category then by confidence desc, così il report è leggibile.
  detected.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return b.confidence - a.confidence
  })

  return detected
}

interface MatchContext {
  html: string
  headers: Record<string, string>
  scriptSrcs: string[]
  metaTags: Record<string, string>
  cookieNames: string[]
}

function applyFingerprint(fp: Fingerprint, ctx: MatchContext): DetectedTech | null {
  const matchedVia: DetectedTech['matchedVia'] = []
  let confidence = 0
  let version: string | undefined

  // meta tag — peso 100, version-bearing più affidabile
  if (fp.metaName && fp.metaContentPattern) {
    const metaContent = ctx.metaTags[fp.metaName.toLowerCase()]
    if (metaContent) {
      const m = metaContent.match(fp.metaContentPattern)
      if (m) {
        matchedVia.push('meta')
        confidence = Math.max(confidence, 100)
        if (fp.versionFrom === 'meta' || (!version && m.groups?.version)) {
          version = m.groups?.version || version
        }
      }
    }
  }

  // header — peso 80
  if (fp.headerKey && fp.headerValuePattern) {
    const v = ctx.headers[fp.headerKey.toLowerCase()]
    if (v) {
      const m = v.match(fp.headerValuePattern)
      if (m) {
        matchedVia.push('header')
        confidence = Math.max(confidence, 80)
        if (fp.versionFrom === 'header' && m.groups?.version) {
          version = m.groups.version
        }
      }
    }
  }

  // script src — peso 70
  if (fp.scriptPattern) {
    for (const src of ctx.scriptSrcs) {
      const m = src.match(fp.scriptPattern)
      if (m) {
        matchedVia.push('script')
        confidence = Math.max(confidence, 70)
        if (fp.versionFrom === 'script' && m.groups?.version) {
          version = m.groups.version
        }
        break
      }
    }
  }

  // html body — peso 60
  if (fp.htmlPattern) {
    const m = ctx.html.match(fp.htmlPattern)
    if (m) {
      matchedVia.push('html')
      confidence = Math.max(confidence, 60)
      if (fp.versionFrom === 'html' && m.groups?.version) {
        version = m.groups.version
      }
    }
  }

  // cookie — peso 70
  if (fp.cookiePattern) {
    for (const name of ctx.cookieNames) {
      if (fp.cookiePattern.test(name)) {
        matchedVia.push('cookie')
        confidence = Math.max(confidence, 70)
        break
      }
    }
  }

  if (confidence === 0) return null

  return {
    name: fp.name,
    category: fp.category,
    website: fp.website,
    iconSlug: fp.iconSlug,
    confidence,
    version,
    matchedVia,
  }
}

// -------------------------------------------------------------------------
// helpers — extraction da HTML grezzo (no DOM parser)
// -------------------------------------------------------------------------

function extractScriptSrcs(html: string): string[] {
  const re = /<script[^>]+src=["']([^"']+)["']/gi
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    out.push(m[1])
  }
  return out
}

function extractMetaTags(html: string): Record<string, string> {
  // Match <meta name="..." content="..."> in entrambi gli ordini di attributo.
  const out: Record<string, string> = {}
  const re = /<meta\b([^>]+)>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1]
    const nameMatch = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i)
    const contentMatch = attrs.match(/\bcontent\s*=\s*["']([^"']*)["']/i)
    if (nameMatch && contentMatch) {
      out[nameMatch[1].toLowerCase()] = contentMatch[1]
    }
    // anche http-equiv, raramente usato per detection
    const httpEquivMatch = attrs.match(/\bhttp-equiv\s*=\s*["']([^"']+)["']/i)
    if (httpEquivMatch && contentMatch) {
      out[httpEquivMatch[1].toLowerCase()] = contentMatch[1]
    }
  }
  return out
}
