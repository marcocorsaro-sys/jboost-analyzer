/**
 * V4 — Word (.docx) generator for the audit report (Output Preview tab).
 *
 * WHY server-only: `docx` is a pure-JS package but it belongs to the export
 * route alone — it must never enter a client bundle, so nothing under
 * components/ may import this module (route → generator, one direction).
 *
 * Style: sober consultancy document — hierarchical headings, tables with a
 * light-grey shaded header row, no decorative colours. The narrative and the
 * numbers come from the shared ReportModel; this file is only layout.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { ReportModel, ReportDriverSection, ReportTable } from './report-model'
import { B } from '../../brand'
import { fmtScore } from './report-model'

// Sober consultancy palette (hex without #, as docx wants them).
// Accent = JAKALA navy from lib/brand.ts.
const INK = '1F2328' // body text
const MUTED = '6B7280' // captions
const ACCENT = B.primary.slice(1).toUpperCase() // JAKALA navy cover band
const HEADER_SHADE = 'EFF1F4' // table header shading
const RULE = 'D6D9DE' // table borders

const border = { style: BorderStyle.SINGLE, size: 4, color: RULE } as const
const allBorders = { top: border, bottom: border, left: border, right: border }

function headerCell(text: string): TableCell {
  return new TableCell({
    shading: { type: ShadingType.CLEAR, fill: HEADER_SHADE },
    borders: allBorders,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 18, color: INK })],
      }),
    ],
  })
}

function bodyCell(text: string, opts: { bold?: boolean; muted?: boolean } = {}): TableCell {
  return new TableCell({
    borders: allBorders,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text, size: 18, bold: opts.bold ?? false, color: opts.muted ? MUTED : INK }),
        ],
      }),
    ],
  })
}

function simpleTable(columns: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: columns.map(headerCell) }),
      ...rows.map((r) => new TableRow({ children: r.map((c) => bodyCell(c)) })),
    ],
  })
}

function caption(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text, italics: true, size: 16, color: MUTED })],
  })
}

function body(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 20, color: INK })],
  })
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, size: 20, color: INK })],
  })
}

// ---------------------------------------------------------------------------

function driverChildren(d: ReportDriverSection, model: ReportModel): Array<Paragraph | Table> {
  const L = model.labels
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [new TextRun(d.label)],
    }),
  ]

  // Non-measured driver: the state and the reason, never numbers (sheet 8).
  if (d.status !== 'done') {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(L.notMeasured)],
      }),
      body(d.statusNote ?? '—'),
    )
    return children
  }

  // 1 · Score — client + competitors side by side.
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(L.secScore)] }))
  children.push(
    simpleTable(
      [L.colSite, L.colRelative, L.colAbsolute, L.colRaw, L.colRank],
      d.scores.map((s) => [
        s.isClient ? `${s.name} (${L.client})` : s.name,
        fmtScore(s.scoreRelative),
        d.hasAbsoluteView ? fmtScore(s.scoreAbsolute) : L.relativeOnlyNote,
        fmtScore(s.raw),
        s.rank === null ? '—' : s.rank === 1 ? `1 (${L.leader})` : String(s.rank),
      ]),
    ),
  )
  if (d.criteria) children.push(caption(d.criteria))

  // 2 · Summary — 3-4 sober bullets.
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(L.secSummary)] }))
  if (d.summaryStatus === 'done') {
    for (const b of d.summaryBullets) children.push(bullet(b))
  } else if (d.summaryStatus === 'error') {
    children.push(body(`${L.summaryErrorPrefix}.`))
  } else {
    children.push(body(L.notGenerated))
  }

  // 3 · Data — key scalars + evidence tables, criteria repeated as caption.
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(L.secData)] }))
  if (d.criteria) children.push(caption(d.criteria))
  if (d.dataRows.length > 0) {
    children.push(
      simpleTable(
        ['', ''],
        d.dataRows.map((r) => [r.label, r.value]),
      ),
    )
  }
  for (const t of d.dataTables) {
    children.push(caption(t.title))
    children.push(simpleTable(t.columns, t.rows))
  }
  if (d.dataRows.length === 0 && d.dataTables.length === 0) children.push(body('—'))

  // 4 · Issues — the golden-standard table Area · Problema · Impatto ·
  // Soluzione · Priorità (README 01 §6).
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(L.secIssues)] }))
  if (d.issuesStatus === 'done' && d.issues.length > 0) {
    children.push(
      simpleTable(
        [L.colArea, L.colProblem, L.colImpact, L.colSolution, L.colPriority],
        d.issues.map((i) => [i.area, i.problem, i.impact, i.solution, i.priority]),
      ),
    )
  } else if (d.issuesStatus === 'error') {
    children.push(body(`${L.summaryErrorPrefix}: ${d.issuesError ?? '—'}`))
  } else if (d.issuesStatus === 'done') {
    children.push(body(L.noIssues))
  } else {
    children.push(body(L.notGenerated))
  }

  // 5 · Solutions.
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(L.secSolutions)] }))
  if (d.solutions.length > 0) {
    for (const s of d.solutions) {
      children.push(bullet(`${s.title} — ${s.action} (${L.colPriority.toLowerCase()}: ${s.priority})`))
    }
  } else if (d.solutionsNote) {
    children.push(body(d.solutionsNote))
  } else if (d.issuesStatus !== 'done') {
    children.push(body(L.notGenerated))
  } else {
    children.push(body(L.noIssues))
  }

  return children
}

// ---------------------------------------------------------------------------

export async function generateDocx(model: ReportModel): Promise<Buffer> {
  const L = model.labels

  // Cover.
  const cover: Paragraph[] = [
    // JAKALA navy band with the "goccia" mark (kept typographic: ▼ glyph).
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: ACCENT },
      spacing: { after: 120 },
      children: [new TextRun({ text: ' ', size: 40 })],
    }),
    new Paragraph({ spacing: { before: 2200 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: model.cover.title, bold: true, size: 56, color: INK })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 },
      children: [new TextRun({ text: L.coverSubtitle, size: 24, color: MUTED })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600 },
      children: [
        new TextRun({ text: `${L.preparedFor}: `, size: 24, color: MUTED }),
        new TextRun({ text: model.cover.client, bold: true, size: 24, color: INK }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${L.domain}: ${model.cover.domain}`, size: 22, color: INK })],
    }),
    ...(model.cover.industry
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `${L.industry}: ${model.cover.industry}`, size: 22, color: INK })],
          }),
        ]
      : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `${L.competitorSet}: ${model.cover.competitors.length > 0 ? model.cover.competitors.join(', ') : L.noCompetitors}`,
          size: 22,
          color: INK,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400 },
      children: [
        new TextRun({
          text: `${model.cover.refDate ? `${L.refDate}: ${model.cover.refDate} · ` : ''}${L.generatedAt}: ${model.cover.generatedAt}`,
          size: 20,
          color: MUTED,
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ]

  // Table of contents (field: Word refreshes it on open).
  const toc: Array<Paragraph | TableOfContents> = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(L.toc)] }),
    new TableOfContents(L.toc, { hyperlink: true, headingStyleRange: '1-2' }),
    new Paragraph({ children: [new PageBreak()] }),
  ]

  // Overview.
  const overview: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(L.overviewTitle)] }),
    caption(L.overviewNote),
    simpleTable(
      [L.colDriver, L.colFamily, L.colRelative, L.colAbsolute, L.colRank, L.colStatus],
      model.overview.rows.map((r) => [
        r.label,
        r.family === 'business' ? L.familyBusiness : L.familyDevelopment,
        fmtScore(r.scoreRelative),
        r.hasAbsoluteView ? fmtScore(r.scoreAbsolute) : L.relativeOnlyNote,
        r.rank === null ? '—' : String(r.rank),
        r.statusLabel,
      ]),
    ),
  ]

  // Driver sections.
  const drivers = model.drivers.flatMap((d) => driverChildren(d, model))

  // Executive Summary.
  const exec: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [new TextRun(L.execTitle)],
    }),
  ]
  if (model.summary.status !== 'done') {
    exec.push(
      body(
        model.summary.status === 'error'
          ? `${L.summaryErrorPrefix}: ${model.summary.error ?? '—'}`
          : L.execNotGenerated,
      ),
    )
  } else {
    if (model.summary.alerts.length > 0) {
      exec.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(L.alerts)] }))
      for (const a of model.summary.alerts) exec.push(bullet(a))
    }
    if (model.summary.headline) {
      exec.push(
        new Paragraph({
          spacing: { before: 160, after: 160 },
          children: [new TextRun({ text: model.summary.headline, bold: true, size: 28, color: INK })],
        }),
      )
    }
    if (model.summary.scorecard) {
      exec.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(L.scorecard)] }))
      exec.push(body(model.summary.scorecard))
    }
    if (model.summary.correlations.length > 0) {
      exec.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(L.correlations)] }))
      for (const c of model.summary.correlations) {
        exec.push(bullet(`${c.title} — ${c.explanation}${c.drivers.length > 0 ? ` (${L.driversInvolved}: ${c.drivers.join(', ')})` : ''}`))
      }
    }
    if (model.summary.priorities.length > 0) {
      exec.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(L.priorities)] }))
      exec.push(
        simpleTable(
          [L.colPriority, L.colImpact, `${L.months}`, L.driversInvolved],
          model.summary.priorities.map((p) => [
            `${p.title} — ${p.rationale}`,
            p.impact,
            String(p.horizonMonths),
            p.drivers.join(', '),
          ]),
        ),
      )
    }
  }

  const doc = new Document({
    creator: 'JBoost Analyzer',
    title: `${model.cover.title} — ${model.cover.client}`,
    description: L.coverSubtitle,
    features: { updateFields: true }, // so Word offers to refresh the TOC
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 20, color: INK } },
        heading1: {
          run: { font: 'Calibri', size: 32, bold: true, color: INK },
          paragraph: { spacing: { before: 320, after: 160 } },
        },
        heading2: {
          run: { font: 'Calibri', size: 24, bold: true, color: INK },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
      },
    },
    sections: [
      {
        properties: {},
        children: [...cover, ...toc, ...overview, ...drivers, ...exec],
      },
    ],
  })

  return Packer.toBuffer(doc)
}
