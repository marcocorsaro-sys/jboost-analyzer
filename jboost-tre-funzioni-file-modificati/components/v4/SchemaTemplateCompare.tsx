'use client'

/**
 * V4 — Schema driver: comparison by template.
 *
 * Sub-navigation = the templates chosen in the setup. For the selected
 * template, one column per player and one row per structured-data type:
 * applicable, detected (with the rubric level) and what is missing or
 * incomplete, plus the template score of each player. Everything shown is
 * what the driver recorded in `evidence.per_template`; nothing is recomputed.
 *
 * A page that could not be scraped says so — never a 0. A template a player
 * does not have says "template non configurato".
 */

import { useState } from 'react'
import type React from 'react'
import { useLocale } from '@/lib/i18n'
import { B } from '@/lib/brand'
import { buildSchemaComparison, typeRowsFor, type CompareCell } from '@/lib/v4/schema-compare'
import { card, sectionTitle, ghostButton, pill, scoreColor } from './results-shared'
import type { DriverRow } from './RunProgress'
import type { SiteMeta } from './results-shared'

const LEVEL_COLOR = (level: number): string =>
  level >= 1 ? B.success : level >= 0.75 ? B.teal : level >= 0.5 ? B.warning : B.error

const cellStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderTop: `1px solid ${B.border}`,
  verticalAlign: 'top',
  fontSize: '14px',
  color: B.ink,
}

export default function SchemaTemplateCompare({ row, sites }: { row: DriverRow; sites: SiteMeta[] }) {
  const { t } = useLocale()
  const comparison = buildSchemaComparison(row.sites)
  const [picked, setPicked] = useState<string | null>(null)

  const nameOf = (siteRef: string, domain: string) => sites.find((s) => s.site_ref === siteRef)?.name ?? domain
  const players = [...row.sites].sort((a, b) => Number(b.site_ref === 'client') - Number(a.site_ref === 'client'))

  if (!comparison.hasDetail) {
    return (
      <div style={card}>
        <h4 style={{ ...sectionTitle, margin: '0 0 8px 0' }}>{t('v4res.schema_cmp_title')}</h4>
        <div style={{ fontSize: '14px', color: B.muted }}>{t('v4res.schema_cmp_rerun')}</div>
      </div>
    )
  }

  const active = comparison.templates.find((x) => x.key === picked)?.key ?? comparison.templates[0]?.key
  if (!active) return null
  const cells = comparison.cells[active] ?? {}
  const rows = typeRowsFor(cells)

  return (
    <div style={card}>
      <h4 style={{ ...sectionTitle, margin: '0 0 6px 0' }}>{t('v4res.schema_cmp_title')}</h4>
      <div style={{ fontSize: '14px', color: B.muted, marginBottom: '14px' }}>{t('v4res.schema_cmp_hint')}</div>

      <div role="tablist" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {comparison.templates.map((tpl) => (
          <button
            key={tpl.key}
            type="button"
            role="tab"
            aria-selected={tpl.key === active}
            onClick={() => setPicked(tpl.key)}
            style={{
              ...ghostButton,
              padding: '6px 12px',
              borderColor: tpl.key === active ? B.primary : B.border,
              color: tpl.key === active ? B.primary : B.muted,
            }}
          >
            {tpl.label}
          </button>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left', color: B.muted }}>
                {t('v4res.schema_cmp_type')}
              </th>
              {players.map((p) => (
                <th key={p.site_ref} style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>
                  {nameOf(p.site_ref, p.domain)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...cellStyle, color: B.muted }}>{t('v4res.schema_cmp_score')}</td>
              {players.map((p) => (
                <td key={p.site_ref} style={cellStyle}>
                  <ScoreCell cell={cells[p.site_ref]} />
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ ...cellStyle, color: B.muted }}>{t('v4res.schema_cmp_url')}</td>
              {players.map((p) => (
                <td key={p.site_ref} style={{ ...cellStyle, wordBreak: 'break-all', fontSize: '13px', color: B.muted }}>
                  {cells[p.site_ref]?.url || '—'}
                </td>
              ))}
            </tr>
            {rows.length === 0 && (
              <tr>
                <td colSpan={players.length + 1} style={{ ...cellStyle, color: B.muted }}>
                  {t('v4res.schema_cmp_nothing_applicable')}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.type}>
                <td style={cellStyle}>
                  <div style={{ fontWeight: 600 }}>{r.type}</div>
                  {r.extra && <div style={{ fontSize: '13px', color: B.muted }}>{t('v4res.schema_cmp_extra')}</div>}
                </td>
                {players.map((p) => (
                  <td key={p.site_ref} style={cellStyle}>
                    <TypeCell cell={cells[p.site_ref]} type={r.type} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ScoreCell({ cell }: { cell: CompareCell | undefined }) {
  const { t } = useLocale()
  if (!cell) return <span style={{ color: B.muted }}>{t('v4res.schema_cmp_no_page')}</span>
  if (!cell.scraped) {
    return (
      <span style={{ color: B.warning }}>
        {t('v4res.schema_cmp_not_scraped')}
        {cell.error ? <span style={{ display: 'block', fontSize: '13px', color: B.muted }}>{cell.error}</span> : null}
      </span>
    )
  }
  if (cell.score === null) return <span style={{ color: B.muted }}>—</span>
  return <span style={{ ...pill(scoreColor(cell.score)) }}>{Math.round(cell.score)}/100</span>
}

function TypeCell({ cell, type }: { cell: CompareCell | undefined; type: string }) {
  const { t } = useLocale()
  if (!cell) return <span style={{ color: B.muted }}>—</span>
  if (!cell.scraped) return <span style={{ color: B.muted }}>—</span>
  const d = cell.types.find((x) => x.type === type)
  if (!d) return <span style={{ color: B.muted }}>—</span>

  if (!d.detected) {
    return <span style={{ color: B.error, fontWeight: 600 }}>{t('v4res.schema_cmp_absent')}</span>
  }
  const missing: Array<[string, string[]]> = [
    ['v4res.schema_cmp_missing_mandatory', d.missing_mandatory],
    ['v4res.schema_cmp_missing_recommended', d.missing_recommended],
    ['v4res.schema_cmp_missing_advanced', d.missing_advanced],
  ]
  return (
    <div>
      <span style={pill(LEVEL_COLOR(d.level))}>
        {t('v4res.schema_cmp_detected')} · {t('v4res.schema_cmp_level')} {d.level}
      </span>
      {missing
        .filter(([, list]) => list.length > 0)
        .map(([key, list]) => (
          <div key={key} style={{ fontSize: '13px', color: B.muted, marginTop: '4px' }}>
            {t(key as Parameters<typeof t>[0])}: {list.join(', ')}
          </div>
        ))}
      {!d.valid_jsonld && (
        <div style={{ fontSize: '13px', color: B.warning, marginTop: '4px' }}>JSON-LD non valido</div>
      )}
    </div>
  )
}
