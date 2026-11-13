/**
 * V4 — Content crawl upload (CSV / XLSX, UTF-8), pure parsing and validation.
 *
 * One row per URL. Columns, as agreed with the Jakala team: URL, main content,
 * page title, meta description, H1, H2, H3, word count, GSC clicks and
 * impressions (last 12 months), plus the context columns player, template,
 * topic, metrics source, exact period and extraction date. Sample: 3-5 URLs per
 * template per player, ONE for the homepage.
 *
 * What this module does, and deliberately does not do:
 *   - it validates the file and summarizes it (rows per player x template,
 *     missing columns, sample-size and metric-provenance warnings, content
 *     length stats); the full rows stay in the stored file;
 *   - it does not score anything and does not modify the content;
 *   - the per-page character limit is NOT decided yet (to be communicated by
 *     the team): CONTENT_CRAWL_PAGE_CHAR_LIMIT is null, so nothing is cut and
 *     the longest page is reported to help set it.
 *
 * Non-UTF-8 input is an explicit error: a file saved in a legacy encoding
 * corrupts accents and special characters downstream.
 */

import { parseCsvMatrix } from '@/lib/v4/semrush-export'

/** Decided by the team and communicated later; null = no truncation applied. */
export const CONTENT_CRAWL_PAGE_CHAR_LIMIT: number | null = null

export const CRAWL_SAMPLE_MIN = 3
export const CRAWL_SAMPLE_MAX = 5

export type CrawlField =
  | 'url'
  | 'content'
  | 'title'
  | 'meta_description'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'word_count'
  | 'gsc_clicks'
  | 'gsc_impressions'
  | 'player'
  | 'template'
  | 'topic'
  | 'metrics_source'
  | 'period'
  | 'extraction_date'

/** Accepted header spellings (lowercased, separators collapsed). */
const ALIASES: Record<CrawlField, string[]> = {
  url: ['url', 'page url', 'address', 'indirizzo', 'pagina'],
  content: ['main content', 'maincontent', 'content', 'contenuto', 'contenuto principale', 'body'],
  title: ['page title', 'title', 'titolo', 'titolo pagina'],
  meta_description: ['meta description', 'metadescription', 'description', 'descrizione meta', 'meta descrizione'],
  h1: ['h1', 'h1 1', 'h1-1'],
  h2: ['h2', 'h2 1', 'h2-1'],
  h3: ['h3', 'h3 1', 'h3-1'],
  word_count: ['word count', 'wordcount', 'words', 'parole', 'n parole', 'numero parole'],
  gsc_clicks: ['gsc clicks', 'clicks', 'click', 'clic', 'clic gsc', 'gsc click', 'gsc clicks 12m', 'clicks 12m'],
  gsc_impressions: [
    'gsc impressions',
    'impressions',
    'impression',
    'impressioni',
    'impressioni gsc',
    'gsc impressions 12m',
    'impressions 12m',
  ],
  player: ['player', 'sito', 'dominio', 'domain', 'brand'],
  template: ['template', 'tipo pagina', 'page template'],
  topic: ['topic', 'argomento', 'tema'],
  metrics_source: ['metrics source', 'fonte metriche', 'source', 'fonte'],
  period: ['period', 'periodo', 'periodo metriche'],
  extraction_date: ['extraction date', 'data estrazione', 'data di estrazione', 'extracted at'],
}

/** Without these the file cannot be used at all. */
export const CRAWL_REQUIRED: CrawlField[] = ['url', 'content', 'player', 'template']

const normHeader = (h: string): string =>
  h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-./()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Header row -> field -> column index (first match wins). */
export function mapCrawlHeaders(header: string[]): Partial<Record<CrawlField, number>> {
  const out: Partial<Record<CrawlField, number>> = {}
  header.forEach((raw, idx) => {
    const h = normHeader(raw)
    if (!h) return
    for (const field of Object.keys(ALIASES) as CrawlField[]) {
      if (out[field] === undefined && ALIASES[field].map(normHeader).includes(h)) {
        out[field] = idx
        break
      }
    }
  })
  return out
}

/** UTF-8 only: strips a BOM, accepts UTF-16 BOMs, rejects replacement characters. */
export function decodeCrawlText(buffer: Buffer): { text: string | null; error: string | null } {
  let text: string
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.toString('utf16le')
  else text = buffer.toString('utf8')
  text = text.replace(/^﻿/, '')
  if (text.includes('�')) {
    return {
      text: null,
      error: 'il file non è in UTF-8 (caratteri non decodificabili): salva il CSV come "CSV UTF-8" e riprova',
    }
  }
  return { text, error: null }
}

export interface CrawlSite {
  site_ref: string
  domain: string
  name: string
  brand_name?: string | null
}

export interface CrawlGroupSummary {
  site_ref: string | null
  /** The player as written in the file (kept when it matched no site). */
  player: string
  template: string
  rows: number
}

export interface ContentCrawlSummary {
  row_count: number
  /** Fields found / not found, by canonical key. */
  fields_found: CrawlField[]
  fields_missing: CrawlField[]
  groups: CrawlGroupSummary[]
  /** Players of the file that match no site of the analysis. */
  unmatched_players: string[]
  warnings: string[]
  /** Content length stats (characters), to help decide the per-page limit. */
  content_chars: { max: number; avg: number; over_limit: number | null }
  char_limit: number | null
  rows_without_content: number
  duplicate_urls: number
}

export type ContentCrawlParseResult =
  | { ok: true; parsed: ContentCrawlSummary & { columns: string[] } }
  | { ok: false; error: string }

const cellText = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim())

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Template spellings are matched loosely; the stored key stays as written, lowercased. */
const templateKeyOf = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, '_')

export function matchSite(player: string, url: string, sites: CrawlSite[]): CrawlSite | null {
  const host = hostOf(url)
  const byHost = host
    ? sites.find((s) => host === s.domain || host.endsWith(`.${s.domain}`))
    : undefined
  if (byHost) return byHost
  const p = player.trim().toLowerCase().replace(/^www\./, '')
  if (!p) return null
  return (
    sites.find(
      (s) =>
        s.domain === p ||
        s.name.toLowerCase() === p ||
        (s.brand_name ?? '').toLowerCase() === p ||
        (p === 'cliente' && s.site_ref === 'client'),
    ) ?? null
  )
}

export function parseContentCrawlMatrix(
  matrix: unknown[][],
  sites: CrawlSite[],
  charLimit: number | null = CONTENT_CRAWL_PAGE_CHAR_LIMIT,
): ContentCrawlParseResult {
  if (matrix.length === 0) return { ok: false, error: 'il file è vuoto' }

  const header = (matrix[0] ?? []).map(cellText)
  const columns = header.filter((c) => c !== '')
  if (columns.length === 0) return { ok: false, error: 'nessuna intestazione di colonna nella prima riga' }

  const idx = mapCrawlHeaders(header)
  const missingRequired = CRAWL_REQUIRED.filter((f) => idx[f] === undefined)
  if (missingRequired.length > 0) {
    return {
      ok: false,
      error:
        `colonne obbligatorie non trovate: ${missingRequired.join(', ')} ` +
        `(trovate: ${columns.slice(0, 10).join(', ')}${columns.length > 10 ? ', …' : ''})`,
    }
  }

  const dataRows = matrix
    .slice(1)
    .filter((r) => Array.isArray(r) && r.some((c) => cellText(c) !== ''))
  if (dataRows.length === 0) return { ok: false, error: 'nessuna riga dati sotto le intestazioni' }

  const get = (row: unknown[], f: CrawlField): string => (idx[f] === undefined ? '' : cellText(row[idx[f] as number]))

  const warnings: string[] = []
  const groups = new Map<string, CrawlGroupSummary>()
  const unmatched = new Set<string>()
  const seenUrls = new Set<string>()
  let duplicates = 0
  let withoutContent = 0
  let maxChars = 0
  let sumChars = 0
  let counted = 0
  let overLimit = 0
  let missingProvenance = 0
  let hasMetrics = 0

  for (const row of dataRows) {
    const url = get(row, 'url')
    const player = get(row, 'player')
    const template = templateKeyOf(get(row, 'template'))
    const content = get(row, 'content')

    if (url) {
      if (seenUrls.has(url)) duplicates += 1
      seenUrls.add(url)
    }
    if (!content) withoutContent += 1
    else {
      const n = content.length
      maxChars = Math.max(maxChars, n)
      sumChars += n
      counted += 1
      if (charLimit !== null && n > charLimit) overLimit += 1
    }

    const site = matchSite(player, url, sites)
    if (!site && (player || url)) unmatched.add(player || hostOf(url) || url)

    const key = `${site?.site_ref ?? `?${player}`}|${template}`
    const g = groups.get(key) ?? { site_ref: site?.site_ref ?? null, player: player || site?.name || '', template, rows: 0 }
    g.rows += 1
    groups.set(key, g)

    // Metrics without their provenance cannot be compared across players.
    if (get(row, 'gsc_clicks') !== '' || get(row, 'gsc_impressions') !== '') {
      hasMetrics += 1
      if (!get(row, 'metrics_source') || !get(row, 'period') || !get(row, 'extraction_date')) missingProvenance += 1
    }
  }

  const fieldsFound = (Object.keys(idx) as CrawlField[]).sort()
  const fieldsMissing = (Object.keys(ALIASES) as CrawlField[]).filter((f) => idx[f] === undefined)
  if (fieldsMissing.length > 0) {
    warnings.push(`colonne attese non presenti: ${fieldsMissing.join(', ')}`)
  }
  if (withoutContent > 0) warnings.push(`${withoutContent} riga/e senza contenuto principale`)
  if (duplicates > 0) warnings.push(`${duplicates} URL duplicato/i`)
  if (unmatched.size > 0) {
    warnings.push(`player non riconosciuti rispetto all'analisi: ${Array.from(unmatched).join(', ')}`)
  }
  if (missingProvenance > 0) {
    warnings.push(
      `${missingProvenance} riga/e con metriche GSC ma senza fonte, periodo o data di estrazione`,
    )
  }
  if (hasMetrics === 0 && idx.gsc_clicks === undefined && idx.gsc_impressions === undefined) {
    // already covered by fields_missing; no extra noise
  }

  const groupList = Array.from(groups.values()).sort(
    (a, b) => (a.site_ref ?? '~').localeCompare(b.site_ref ?? '~') || a.template.localeCompare(b.template),
  )
  for (const g of groupList) {
    const label = `${g.player || g.site_ref || '?'} · ${g.template}`
    if (g.template === 'homepage') {
      if (g.rows !== 1) warnings.push(`${label}: attesa 1 URL, trovate ${g.rows}`)
    } else if (g.rows < CRAWL_SAMPLE_MIN || g.rows > CRAWL_SAMPLE_MAX) {
      warnings.push(`${label}: attese ${CRAWL_SAMPLE_MIN}-${CRAWL_SAMPLE_MAX} URL, trovate ${g.rows}`)
    }
  }

  return {
    ok: true,
    parsed: {
      columns,
      row_count: dataRows.length,
      fields_found: fieldsFound,
      fields_missing: fieldsMissing,
      groups: groupList,
      unmatched_players: Array.from(unmatched),
      warnings,
      content_chars: {
        max: maxChars,
        avg: counted > 0 ? Math.round(sumChars / counted) : 0,
        over_limit: charLimit === null ? null : overLimit,
      },
      char_limit: charLimit,
      rows_without_content: withoutContent,
      duplicate_urls: duplicates,
    },
  }
}

/** CSV text in, summary out. */
export function parseContentCrawlCsv(text: string, sites: CrawlSite[]): ContentCrawlParseResult {
  if (!text.trim()) return { ok: false, error: 'il file è vuoto' }
  return parseContentCrawlMatrix(parseCsvMatrix(text), sites)
}
