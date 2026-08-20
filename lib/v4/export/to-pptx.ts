/**
 * V4 — PPTX generator for the audit deck (Output Preview tab).
 *
 * WHY server-only: pptxgenjs is pure JS and serverless-safe, but it belongs
 * to the export route alone — components never import it, so it stays out of
 * every client bundle.
 *
 * THEME (documented choice): LIGHT consultancy. The deck is the client-facing
 * deliverable and the UX Bibbia says exports inherit a JAKALA-branded, sober
 * theme — white background, near-black ink, one restrained teal accent, thin
 * grey rules. The product's dark lime theme stays in-app; a consultancy deck
 * printed or projected reads better on white.
 *
 * Format: 16:9 (10 x 5.625 in). Deck outline:
 *   1. cover
 *   2. overview scorecard (driver / score / rank table)
 *   3. per driver: score + summary bullets (+ a second slide with the top
 *      issues table when the insight produced issues)
 *   4. executive summary (priorities as a 3/6/12-month list)
 *   5. critical alerts (only when present)
 */

import PptxGenJS from 'pptxgenjs'
import type { ReportModel, ReportDriverSection } from './report-model'
import { fmtScore } from './report-model'
import { B } from '../../brand'

// Light consultancy palette (accent = JAKALA navy from lib/brand.ts;
// pptxgenjs wants hex without '#').
const INK = '1F2328'
const MUTED = '6B7280'
const ACCENT = B.primary.slice(1).toUpperCase()
const ACCENT_SOFT = B.chartCompetitors[0].slice(1).toUpperCase()
const HEADER_SHADE = 'EFF1F4'
const RULE = 'D6D9DE'

const PAGE_W = 10
const MARGIN = 0.55
const CONTENT_W = PAGE_W - MARGIN * 2

type Slide = PptxGenJS.Slide

function addTitle(slide: Slide, text: string, subtitle?: string): void {
  slide.addText(text, {
    x: MARGIN,
    y: 0.35,
    w: CONTENT_W,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: INK,
    fontFace: 'Calibri',
  })
  slide.addShape('line', {
    x: MARGIN,
    y: 0.95,
    w: CONTENT_W,
    h: 0,
    line: { color: ACCENT, width: 1.5 },
  })
  if (subtitle) {
    slide.addText(subtitle, {
      x: MARGIN,
      y: 1.0,
      w: CONTENT_W,
      h: 0.3,
      fontSize: 11,
      italic: true,
      color: MUTED,
      fontFace: 'Calibri',
    })
  }
}

function tableHeader(cells: string[]): PptxGenJS.TableRow {
  return cells.map((text) => ({
    text,
    options: { bold: true, color: INK, fill: { color: HEADER_SHADE }, fontSize: 10 },
  }))
}

function tableRow(cells: string[], opts: { bold?: boolean } = {}): PptxGenJS.TableRow {
  return cells.map((text) => ({
    text,
    options: { color: INK, fontSize: 9.5, bold: opts.bold ?? false },
  }))
}

const TABLE_BASE: PptxGenJS.TableProps = {
  x: MARGIN,
  w: CONTENT_W,
  border: { type: 'solid', color: RULE, pt: 0.5 },
  fontFace: 'Calibri',
  valign: 'middle',
  autoPage: false,
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// ---------------------------------------------------------------------------

function driverSlides(pptx: PptxGenJS, d: ReportDriverSection, model: ReportModel): void {
  const L = model.labels
  const slide = pptx.addSlide()
  addTitle(slide, d.label, d.criteria ?? undefined)

  if (d.status !== 'done') {
    // Not measured: state + reason, no numbers (sheet 8 null discipline).
    slide.addText(L.notMeasured, {
      x: MARGIN, y: 1.6, w: CONTENT_W, h: 0.4, fontSize: 16, bold: true, color: MUTED, fontFace: 'Calibri',
    })
    slide.addText(d.statusNote ?? '—', {
      x: MARGIN, y: 2.1, w: CONTENT_W, h: 1.6, fontSize: 12, color: MUTED, fontFace: 'Calibri', valign: 'top',
    })
    return
  }

  // Score table: client + competitors side by side.
  const scoreRows: PptxGenJS.TableRow[] = [
    tableHeader([L.colSite, L.colRelative, L.colAbsolute, L.colRaw, L.colRank]),
    ...d.scores.map((s) =>
      tableRow(
        [
          s.isClient ? `${s.name} (${L.client})` : s.name,
          fmtScore(s.scoreRelative),
          d.hasAbsoluteView ? fmtScore(s.scoreAbsolute) : L.relativeOnlyNote,
          fmtScore(s.raw),
          s.rank === null ? '—' : s.rank === 1 ? `1 (${L.leader})` : String(s.rank),
        ],
        { bold: s.isClient },
      ),
    ),
  ]
  slide.addTable(scoreRows, { ...TABLE_BASE, y: 1.35, colW: [3.1, 1.6, 1.6, 1.5, 1.1] })

  // Summary bullets (3-4, sober) — or the explicit "not generated" note.
  const bulletsY = 1.35 + 0.35 * (d.scores.length + 1) + 0.25
  if (d.summaryStatus === 'done') {
    slide.addText(
      d.summaryBullets.map((b) => ({
        text: clip(b, 220),
        options: { bullet: { code: '2022' }, fontSize: 12, color: INK, breakLine: true, paraSpaceAfter: 6 },
      })),
      { x: MARGIN, y: bulletsY, w: CONTENT_W, h: Math.max(1.2, 5.2 - bulletsY), fontFace: 'Calibri', valign: 'top' },
    )
  } else {
    slide.addText(d.summaryStatus === 'error' ? `${L.summaryErrorPrefix}.` : L.notGenerated, {
      x: MARGIN, y: bulletsY, w: CONTENT_W, h: 0.5, fontSize: 12, italic: true, color: MUTED, fontFace: 'Calibri',
    })
  }

  // Second slide: top issues table, only when the insight produced issues.
  if (d.issues.length > 0) {
    const issuesSlide = pptx.addSlide()
    addTitle(issuesSlide, `${d.label} · ${L.secIssues}`, d.solutionsNote ?? undefined)
    const rows: PptxGenJS.TableRow[] = [
      tableHeader([L.colArea, L.colProblem, L.colImpact, L.colSolution, L.colPriority]),
      ...d.issues.map((i) =>
        tableRow([i.area, clip(i.problem, 80), clip(i.impact, 180), clip(i.solution, 180), i.priority]),
      ),
    ]
    issuesSlide.addTable(rows, { ...TABLE_BASE, y: 1.35, colW: [1.3, 1.9, 2.6, 2.6, 0.5] })
  }
}

// ---------------------------------------------------------------------------

export async function generatePptx(model: ReportModel): Promise<Buffer> {
  const L = model.labels
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = 'JBoost Analyzer'
  pptx.title = `${model.cover.title} — ${model.cover.client}`

  // ---- 1 · Cover -----------------------------------------------------------
  const cover = pptx.addSlide()
  // JAKALA cover: navy band with the "goccia" drop mark.
  cover.addShape('rect', { x: 0, y: 0, w: PAGE_W, h: 0.9, fill: { color: ACCENT } })
  cover.addShape('teardrop', {
    x: PAGE_W - 1.15, y: 0.15, w: 0.6, h: 0.6,
    fill: { color: ACCENT_SOFT, transparency: 25 },
    line: { color: ACCENT_SOFT, transparency: 25 },
    rotate: 135,
  })
  cover.addText(model.cover.title, {
    x: MARGIN, y: 1.5, w: CONTENT_W, h: 0.9, fontSize: 40, bold: true, color: INK, fontFace: 'Calibri',
  })
  cover.addText(L.coverSubtitle, {
    x: MARGIN, y: 2.4, w: CONTENT_W, h: 0.4, fontSize: 14, color: MUTED, fontFace: 'Calibri',
  })
  cover.addText(
    [
      { text: `${L.preparedFor}: ${model.cover.client} · ${model.cover.domain}`, options: { breakLine: true } },
      ...(model.cover.industry ? [{ text: `${L.industry}: ${model.cover.industry}`, options: { breakLine: true } }] : []),
      {
        text: `${L.competitorSet}: ${model.cover.competitors.length > 0 ? model.cover.competitors.join(', ') : L.noCompetitors}`,
        options: { breakLine: true },
      },
      {
        text: `${model.cover.refDate ? `${L.refDate}: ${model.cover.refDate} · ` : ''}${L.generatedAt}: ${model.cover.generatedAt}`,
        options: { color: MUTED },
      },
    ],
    { x: MARGIN, y: 3.3, w: CONTENT_W, h: 1.6, fontSize: 13, color: INK, fontFace: 'Calibri', valign: 'top' },
  )

  // ---- 2 · Overview scorecard ---------------------------------------------
  const overview = pptx.addSlide()
  addTitle(overview, L.overviewTitle, L.overviewNote)
  const overviewRows: PptxGenJS.TableRow[] = [
    tableHeader([L.colDriver, L.colFamily, L.colRelative, L.colAbsolute, L.colRank, L.colStatus]),
    ...model.overview.rows.map((r) =>
      tableRow([
        r.label,
        r.family === 'business' ? L.familyBusiness : L.familyDevelopment,
        fmtScore(r.scoreRelative),
        r.hasAbsoluteView ? fmtScore(r.scoreAbsolute) : L.relativeOnlyNote,
        r.rank === null ? '—' : String(r.rank),
        r.statusLabel,
      ]),
    ),
  ]
  overview.addTable(overviewRows, { ...TABLE_BASE, y: 1.45, colW: [1.9, 1.3, 1.4, 1.6, 0.9, 1.8] })

  // ---- 3 · Driver slides ---------------------------------------------------
  for (const d of model.drivers) driverSlides(pptx, d, model)

  // ---- 4 · Executive Summary ----------------------------------------------
  const exec = pptx.addSlide()
  addTitle(exec, L.execTitle)
  if (model.summary.status !== 'done') {
    exec.addText(
      model.summary.status === 'error'
        ? `${L.summaryErrorPrefix}: ${model.summary.error ?? '—'}`
        : L.execNotGenerated,
      { x: MARGIN, y: 1.6, w: CONTENT_W, h: 0.8, fontSize: 13, italic: true, color: MUTED, fontFace: 'Calibri' },
    )
  } else {
    if (model.summary.headline) {
      exec.addText(model.summary.headline, {
        x: MARGIN, y: 1.25, w: CONTENT_W, h: 0.7, fontSize: 17, bold: true, color: ACCENT, fontFace: 'Calibri',
      })
    }
    if (model.summary.scorecard) {
      exec.addText(clip(model.summary.scorecard, 700), {
        x: MARGIN, y: 2.0, w: CONTENT_W, h: 1.1, fontSize: 11.5, color: INK, fontFace: 'Calibri', valign: 'top',
      })
    }
    // Priorities as a temporal list (3 → 6 → 12 months).
    const horizons = [3, 6, 12]
    const items = horizons.flatMap((h) => {
      const inH = model.summary.priorities.filter((p) => p.horizonMonths === h)
      if (inH.length === 0) return []
      return [
        { text: `${h} ${L.months}`, options: { bold: true, color: ACCENT, fontSize: 12, breakLine: true, paraSpaceBefore: 6 } },
        ...inH.map((p) => ({
          text: `${p.title} — ${clip(p.rationale, 200)} (${L.impact}: ${p.impact})`,
          options: { bullet: { code: '2022' }, fontSize: 10.5, color: INK, breakLine: true, paraSpaceAfter: 4 },
        })),
      ]
    })
    if (items.length > 0) {
      exec.addText(items, {
        x: MARGIN, y: 3.15, w: CONTENT_W, h: 2.2, fontFace: 'Calibri', valign: 'top',
      })
    }
  }

  // ---- 5 · Alerts (only when present) -------------------------------------
  if (model.summary.status === 'done' && model.summary.alerts.length > 0) {
    const alerts = pptx.addSlide()
    addTitle(alerts, L.alerts)
    alerts.addText(
      model.summary.alerts.map((a) => ({
        text: a,
        options: { bullet: { code: '2022' }, fontSize: 13, color: 'B42318', breakLine: true, paraSpaceAfter: 8 },
      })),
      { x: MARGIN, y: 1.5, w: CONTENT_W, h: 3.6, fontFace: 'Calibri', valign: 'top' },
    )
  }

  const out = await pptx.write({ outputType: 'nodebuffer' })
  return out as Buffer
}
