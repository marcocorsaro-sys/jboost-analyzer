/**
 * V4 — pure shaping of the Schema evidence into the per-template comparison.
 *
 * Client-safe (no server imports): the evidence JSON is the wire format, this
 * module only validates and regroups it. Nothing is recomputed here — scores,
 * levels and missing properties are exactly what the driver recorded.
 */

import { TEMPLATE_KEYS, TEMPLATE_LABELS } from '@/lib/v4/setup'

export interface CompareType {
  type: string
  applicable: boolean
  detected: boolean
  level: number
  reason: string
  missing_mandatory: string[]
  missing_recommended: string[]
  missing_advanced: string[]
  nodes: number
  valid_jsonld: boolean
}

export interface CompareCell {
  template_key: string
  url: string
  scraped: boolean
  error: string | null
  score: number | null
  types: CompareType[]
  types_found_outside_kb: string[]
}

export interface CompareSite {
  site_ref: string
  domain: string
  evidence?: Record<string, unknown>
}

export interface SchemaComparison {
  /** Templates in wizard order, then any unknown key, only those with a cell. */
  templates: Array<{ key: string; label: string }>
  /** template_key -> site_ref -> cell (absent = template not configured for that site). */
  cells: Record<string, Record<string, CompareCell>>
  /** false when no site carries `per_template` (measurement older than the tab). */
  hasDetail: boolean
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

function asType(v: unknown): CompareType | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.type !== 'string') return null
  return {
    type: o.type,
    applicable: o.applicable === true,
    detected: o.detected === true,
    level: typeof o.level === 'number' ? o.level : 0,
    reason: typeof o.reason === 'string' ? o.reason : '',
    missing_mandatory: strings(o.missing_mandatory),
    missing_recommended: strings(o.missing_recommended),
    missing_advanced: strings(o.missing_advanced),
    nodes: typeof o.nodes === 'number' ? o.nodes : 0,
    valid_jsonld: o.valid_jsonld !== false,
  }
}

function asCell(v: unknown): CompareCell | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.template_key !== 'string') return null
  return {
    template_key: o.template_key,
    url: typeof o.url === 'string' ? o.url : '',
    scraped: o.scraped !== false,
    error: typeof o.error === 'string' ? o.error : null,
    score: typeof o.score === 'number' ? o.score : null,
    types: Array.isArray(o.types) ? o.types.map(asType).filter((t): t is CompareType => t !== null) : [],
    types_found_outside_kb: strings(o.types_found_outside_kb),
  }
}

export function buildSchemaComparison(sites: CompareSite[]): SchemaComparison {
  const cells: SchemaComparison['cells'] = {}
  let hasDetail = false

  for (const site of sites) {
    const list = site.evidence?.per_template
    if (!Array.isArray(list)) continue
    hasDetail = true
    for (const raw of list) {
      const cell = asCell(raw)
      if (!cell) continue
      ;(cells[cell.template_key] ??= {})[site.site_ref] = cell
    }
  }

  const known = (TEMPLATE_KEYS as readonly string[]).filter((k) => cells[k])
  const unknown = Object.keys(cells).filter((k) => !(TEMPLATE_KEYS as readonly string[]).includes(k))
  const templates = [...known, ...unknown].map((key) => ({
    key,
    label: (TEMPLATE_LABELS as Record<string, string>)[key] ?? key,
  }))

  return { templates, cells, hasDetail }
}

/**
 * The type rows of one template: every type applicable for ANY player, then
 * the types detected only outside the template's expectation. Order follows
 * the first cell that lists the type, so it is stable across renders.
 */
export function typeRowsFor(cellsOfTemplate: Record<string, CompareCell>): Array<{ type: string; extra: boolean }> {
  const applicable: string[] = []
  const extra: string[] = []
  for (const cell of Object.values(cellsOfTemplate)) {
    for (const t of cell.types) {
      if (t.applicable && !applicable.includes(t.type)) applicable.push(t.type)
    }
  }
  for (const cell of Object.values(cellsOfTemplate)) {
    for (const t of cell.types) {
      if (!t.applicable && t.detected && !applicable.includes(t.type) && !extra.includes(t.type)) extra.push(t.type)
    }
  }
  return [
    ...applicable.map((type) => ({ type, extra: false })),
    ...extra.map((type) => ({ type, extra: true })),
  ]
}
