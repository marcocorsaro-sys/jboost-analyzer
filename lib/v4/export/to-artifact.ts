/**
 * V4 — interactive HTML artifact generator (Output Preview tab).
 *
 * WHY a single self-contained file: the artifact is the "share by link/file"
 * deliverable — it must open anywhere with zero runtime dependencies, so all
 * CSS is inline and the only interactivity is a few lines of vanilla JS
 * (anchor navigation + the Absolute/Relative toggle where the data has both
 * views). Same light consultancy theme as the PPTX/Word exports: the three
 * formats are one deliverable in three shapes.
 *
 * Server-only by convention (route → generator); nothing under components/
 * imports this module.
 */

import type { ReportModel, ReportDriverSection, ReportTable } from './report-model'
import { fmtScore } from './report-model'

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tableHtml(columns: string[], rows: string[][], caption?: string): string {
  return `
  ${caption ? `<p class="caption">${esc(caption)}</p>` : ''}
  <table>
    <thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`
}

function evidenceTableHtml(t: ReportTable): string {
  return tableHtml(t.columns, t.rows, t.title)
}

/**
 * The dual-view score: markup carries BOTH values, the body class decides
 * which one shows. Drivers without an absolute view always show relative.
 */
function dualScore(rel: number | null, abs: number | null, hasAbs: boolean, relOnlyNote: string): string {
  if (!hasAbs) return `<span class="score">${esc(fmtScore(rel))}</span> <span class="muted">(${esc(relOnlyNote)})</span>`
  return `<span class="score v-rel">${esc(fmtScore(rel))}</span><span class="score v-abs">${esc(fmtScore(abs))}</span>`
}

function driverSectionHtml(d: ReportDriverSection, model: ReportModel): string {
  const L = model.labels

  if (d.status !== 'done') {
    return `
<section id="drv-${esc(d.key)}">
  <h2>${esc(d.label)}</h2>
  <div class="notice">${esc(L.notMeasured)}: ${esc(d.statusNote ?? '—')}</div>
</section>`
  }

  const scoreRows = d.scores.map((s) => [
    s.isClient ? `${s.name} (${L.client})` : s.name,
    fmtScore(s.scoreRelative),
    d.hasAbsoluteView ? fmtScore(s.scoreAbsolute) : L.relativeOnlyNote,
    fmtScore(s.raw),
    s.rank === null ? '—' : s.rank === 1 ? `1 (${L.leader})` : String(s.rank),
  ])

  const summary =
    d.summaryStatus === 'done'
      ? `<ul>${d.summaryBullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
      : `<p class="muted-block">${esc(d.summaryStatus === 'error' ? `${L.summaryErrorPrefix}.` : L.notGenerated)}</p>`

  const dataRows =
    d.dataRows.length > 0
      ? `<table class="kv">${d.dataRows
          .map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`)
          .join('')}</table>`
      : ''

  const issues =
    d.issuesStatus === 'done' && d.issues.length > 0
      ? tableHtml(
          [L.colArea, L.colProblem, L.colImpact, L.colSolution, L.colPriority],
          d.issues.map((i) => [i.area, i.problem, i.impact, i.solution, i.priority]),
        )
      : `<p class="muted-block">${esc(
          d.issuesStatus === 'error'
            ? `${L.summaryErrorPrefix}: ${d.issuesError ?? '—'}`
            : d.issuesStatus === 'done'
              ? L.noIssues
              : L.notGenerated,
        )}</p>`

  const solutions =
    d.solutions.length > 0
      ? `<ul>${d.solutions
          .map(
            (s) =>
              `<li><strong>${esc(s.title)}</strong> — ${esc(s.action)} <span class="muted">(${esc(
                L.colPriority.toLowerCase(),
              )}: ${esc(s.priority)})</span></li>`,
          )
          .join('')}</ul>`
      : d.solutionsNote
        ? `<p class="muted-block">${esc(d.solutionsNote)}</p>`
        : `<p class="muted-block">${esc(d.issuesStatus !== 'done' ? L.notGenerated : L.noIssues)}</p>`

  return `
<section id="drv-${esc(d.key)}">
  <h2>${esc(d.label)} <span class="tag">${esc(d.family === 'business' ? L.familyBusiness : L.familyDevelopment)}</span></h2>

  <h3>${esc(L.secScore)}</h3>
  <p class="headline-score">${dualScore(
    d.scores[0]?.scoreRelative ?? null,
    d.scores[0]?.scoreAbsolute ?? null,
    d.hasAbsoluteView,
    L.relativeOnlyNote,
  )}</p>
  ${tableHtml([L.colSite, L.colRelative, L.colAbsolute, L.colRaw, L.colRank], scoreRows)}
  ${d.criteria ? `<p class="caption">${esc(d.criteria)}</p>` : ''}

  <h3>${esc(L.secSummary)}</h3>
  ${summary}

  <h3>${esc(L.secData)}</h3>
  ${d.criteria ? `<p class="caption">${esc(d.criteria)}</p>` : ''}
  ${dataRows}
  ${d.dataTables.map(evidenceTableHtml).join('')}
  ${d.dataRows.length === 0 && d.dataTables.length === 0 ? '<p class="muted-block">—</p>' : ''}

  <h3>${esc(L.secIssues)}</h3>
  ${issues}

  <h3>${esc(L.secSolutions)}</h3>
  ${solutions}
</section>`
}

// ---------------------------------------------------------------------------

export function generateArtifact(model: ReportModel): string {
  const L = model.labels
  const anyAbsolute = model.drivers.some((d) => d.hasAbsoluteView && d.status === 'done')

  const nav = [
    `<a href="#overview">${esc(L.overviewTitle)}</a>`,
    ...model.drivers.map((d) => `<a href="#drv-${esc(d.key)}">${esc(d.label)}</a>`),
    `<a href="#exec">${esc(L.execTitle)}</a>`,
  ].join('')

  const overviewTable = tableHtml(
    [L.colDriver, L.colFamily, L.colRelative, L.colAbsolute, L.colRank, L.colStatus],
    model.overview.rows.map((r) => [
      r.label,
      r.family === 'business' ? L.familyBusiness : L.familyDevelopment,
      fmtScore(r.scoreRelative),
      r.hasAbsoluteView ? fmtScore(r.scoreAbsolute) : L.relativeOnlyNote,
      r.rank === null ? '—' : String(r.rank),
      r.statusLabel,
    ]),
  )

  const execHtml = (() => {
    const s = model.summary
    if (s.status !== 'done') {
      return `<p class="muted-block">${esc(
        s.status === 'error' ? `${L.summaryErrorPrefix}: ${s.error ?? '—'}` : L.execNotGenerated,
      )}</p>`
    }
    const alerts =
      s.alerts.length > 0
        ? `<div class="alerts"><h3>${esc(L.alerts)}</h3><ul>${s.alerts.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`
        : ''
    const correlations =
      s.correlations.length > 0
        ? `<h3>${esc(L.correlations)}</h3><ul>${s.correlations
            .map(
              (c) =>
                `<li><strong>${esc(c.title)}</strong> — ${esc(c.explanation)}${
                  c.drivers.length > 0 ? ` <span class="muted">(${esc(L.driversInvolved)}: ${esc(c.drivers.join(', '))})</span>` : ''
                }</li>`,
            )
            .join('')}</ul>`
        : ''
    const horizons = [3, 6, 12]
    const priorities =
      s.priorities.length > 0
        ? `<h3>${esc(L.priorities)}</h3>` +
          horizons
            .map((h) => {
              const inH = s.priorities.filter((p) => p.horizonMonths === h)
              if (inH.length === 0) return ''
              return `<h4>${h} ${esc(L.months)}</h4><ul>${inH
                .map(
                  (p) =>
                    `<li><strong>${esc(p.title)}</strong> — ${esc(p.rationale)} <span class="muted">(${esc(
                      L.impact,
                    )}: ${esc(p.impact)}${p.drivers.length > 0 ? ` · ${esc(L.driversInvolved)}: ${esc(p.drivers.join(', '))}` : ''})</span></li>`,
                )
                .join('')}</ul>`
            })
            .join('')
        : ''
    return `
    ${alerts}
    ${s.headline ? `<p class="headline">${esc(s.headline)}</p>` : ''}
    ${s.scorecard ? `<h3>${esc(L.scorecard)}</h3><p>${esc(s.scorecard)}</p>` : ''}
    ${correlations}
    ${priorities}`
  })()

  const toggle = anyAbsolute
    ? `<div class="toggle" role="group">
        <button type="button" id="btn-rel" class="on" onclick="setView('rel')">${esc(L.viewRelative)}</button>
        <button type="button" id="btn-abs" onclick="setView('abs')">${esc(L.viewAbsolute)}</button>
      </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="${model.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.cover.title)} — ${esc(model.cover.client)}</title>
<style>
  :root { --ink:#1f2328; --muted:#6b7280; --accent:#0f766e; --rule:#d6d9de; --shade:#eff1f4; --alert:#b42318; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Georgia, 'Times New Roman', serif; color: var(--ink); background:#ffffff; line-height:1.6; }
  header.cover { padding: 64px 8% 40px; border-bottom: 3px solid var(--accent); }
  header.cover h1 { font-size: 40px; margin: 0 0 6px; }
  header.cover .sub { color: var(--muted); font-size: 15px; margin-bottom: 22px; }
  header.cover .meta { font-size: 14px; }
  nav { position: sticky; top: 0; background: #ffffff; border-bottom: 1px solid var(--rule); padding: 10px 8%; display:flex; flex-wrap:wrap; gap: 4px 18px; font-family: Helvetica, Arial, sans-serif; font-size: 13px; z-index: 5; }
  nav a { color: var(--accent); text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  main { padding: 0 8% 80px; max-width: 1080px; }
  section { padding-top: 28px; border-bottom: 1px solid var(--rule); padding-bottom: 28px; }
  h2 { font-size: 26px; margin: 18px 0 8px; }
  h3 { font-size: 15px; margin: 26px 0 8px; font-family: Helvetica, Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); }
  h4 { margin: 14px 0 4px; font-size: 15px; }
  .tag { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: var(--muted); border: 1px solid var(--rule); border-radius: 4px; padding: 2px 8px; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.05em; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-family: Helvetica, Arial, sans-serif; font-size: 13px; }
  th, td { border: 1px solid var(--rule); padding: 7px 10px; text-align: left; vertical-align: top; }
  thead th { background: var(--shade); }
  table.kv th { width: 34%; background: var(--shade); font-weight: normal; }
  .caption { font-size: 12.5px; color: var(--muted); font-style: italic; margin: 4px 0 10px; }
  .muted { color: var(--muted); }
  .muted-block { color: var(--muted); font-style: italic; }
  .notice { background: var(--shade); border-left: 3px solid var(--muted); padding: 12px 16px; font-size: 14px; }
  .headline-score .score { font-size: 40px; font-weight: bold; }
  .headline { font-size: 22px; font-weight: bold; }
  .alerts { border: 1px solid var(--alert); border-left-width: 4px; padding: 6px 18px 12px; margin: 14px 0; }
  .alerts h3, .alerts li { color: var(--alert); }
  .toggle { margin-left: auto; display: flex; gap: 0; }
  .toggle button { font: 12px Helvetica, Arial, sans-serif; padding: 4px 12px; border: 1px solid var(--rule); background: #ffffff; color: var(--muted); cursor: pointer; }
  .toggle button.on { background: var(--accent); color: #ffffff; border-color: var(--accent); }
  /* Dual-view scores: body class decides which value shows. */
  .v-abs { display: none; }
  body.view-abs .v-abs { display: inline; }
  body.view-abs .v-rel { display: none; }
  @media print { nav { display: none; } }
</style>
</head>
<body>
<header class="cover">
  <h1>${esc(model.cover.title)}</h1>
  <div class="sub">${esc(L.coverSubtitle)}</div>
  <div class="meta">
    <strong>${esc(L.preparedFor)}:</strong> ${esc(model.cover.client)} · ${esc(model.cover.domain)}<br>
    ${model.cover.industry ? `<strong>${esc(L.industry)}:</strong> ${esc(model.cover.industry)}<br>` : ''}
    <strong>${esc(L.competitorSet)}:</strong> ${esc(model.cover.competitors.length > 0 ? model.cover.competitors.join(', ') : L.noCompetitors)}<br>
    <span class="muted">${model.cover.refDate ? `${esc(L.refDate)}: ${esc(model.cover.refDate)} · ` : ''}${esc(L.generatedAt)}: ${esc(model.cover.generatedAt)}</span>
  </div>
</header>
<nav>${nav}${toggle}</nav>
<main>
<section id="overview">
  <h2>${esc(L.overviewTitle)}</h2>
  <p class="caption">${esc(L.overviewNote)}</p>
  ${overviewTable}
</section>
${model.drivers.map((d) => driverSectionHtml(d, model)).join('\n')}
<section id="exec">
  <h2>${esc(L.execTitle)}</h2>
  ${execHtml}
</section>
</main>
<script>
  function setView(v) {
    document.body.classList.toggle('view-abs', v === 'abs');
    var rel = document.getElementById('btn-rel');
    var abs = document.getElementById('btn-abs');
    if (rel && abs) {
      rel.classList.toggle('on', v === 'rel');
      abs.classList.toggle('on', v === 'abs');
    }
  }
</script>
</body>
</html>`
}
