import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseScreamingFrogIssuesCsv } from './screaming-frog-issues'
import { parseSemrushPdfText } from './semrush-pdf'
import { readScreamingFrogIssues } from './drivers/compliance'

const SF_CSV = [
  'Issue Name,Issue Type,Issue Priority,URLs,% of Total,Description,How To Fix',
  '"Missing H1",Issue,Medium,"1.234",12.5%,"Pages without an H1 heading.","Add a unique H1."',
  'Page Titles: Over 60 Characters,Warning,Low,300,3.1%,Titles may truncate.,Shorten titles.',
  'Response Codes: Internal Client Error (4xx),Issue,High,12,0.1%,Broken internal links.,Fix or redirect.',
  'Totale,,,,,,',
].join('\n')

test('Screaming Frog: legge le issue, ordina per priorità poi per URL', () => {
  const r = parseScreamingFrogIssuesCsv(SF_CSV)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.parsed.issue_count, 3)
  assert.deepEqual(
    r.parsed.issues.map((i) => i.name),
    ['Response Codes: Internal Client Error (4xx)', 'Missing H1', 'Page Titles: Over 60 Characters'],
  )
  assert.equal(r.parsed.issues[1].urls, 1234)
  assert.equal(r.parsed.issues[1].pct_of_total, 12.5)
  assert.equal(r.parsed.issues[0].priority, 'high')
})

test('Screaming Frog: formato diverso = errore esplicito con le colonne attese', () => {
  const r = parseScreamingFrogIssuesCsv('Address,Status Code\nhttps://a.it,200\n')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /Issue Name/)
})

test('Screaming Frog: separatore punto e virgola', () => {
  const r = parseScreamingFrogIssuesCsv('Issue Name;Issue Priority;URLs\nMissing H1;High;5\n')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.parsed.issues[0].urls, 5)
})

const PDF_LABEL_FIRST = `Site Audit: www.ariston.com
Site Health
90%
AI Search Health
99%
Crawled Pages 104
Healthy 101
Have issues 1
Redirects 2
Broken 0
Blocked 0
Errors 1
Warnings 4
Notices 12
`

test('PDF Semrush: Site Health, AI Search Health e conteggi (etichetta prima del valore)', () => {
  const r = parseSemrushPdfText(PDF_LABEL_FIRST)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.parsed.site_health, 90)
  assert.equal(r.extra.ai_search_health, 99)
  assert.equal(r.extra.pages_crawled, 104)
  assert.equal(r.extra.pages_breakdown.healthy, 101)
  assert.equal(r.extra.errors, 1)
  assert.equal(r.extra.warnings, 4)
})

test('PDF Semrush: layout con valore prima dell’etichetta e stesso punteggio', () => {
  const r = parseSemrushPdfText('90%\nSite Health\n99%\nAI Search Health\n')
  // "Site Health" -> dopo: 99 (vicino), prima: 90 -> ambiguo, mai indovinato.
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /CSV\/XLSX/)
})

test('PDF Semrush: nessun Site Health = errore, mai 0', () => {
  const r = parseSemrushPdfText('Report generico senza punteggi')
  assert.equal(r.ok, false)
  const e = parseSemrushPdfText('   ')
  assert.equal(e.ok, false)
})

test('Compliance: legge le issue SF dalla config del run', () => {
  const cfg = {
    attachments: [
      { kind: 'compliance_semrush', name: 'x.csv' },
      {
        kind: 'compliance_crawl',
        name: 'sf.csv',
        parsed: { sf_issues: [{ name: 'Missing H1', urls: 3 }], sf_issue_count: 7 },
      },
    ],
  }
  const r = readScreamingFrogIssues(cfg)
  assert.equal(r?.source_file, 'sf.csv')
  assert.equal(r?.issue_count, 7)
  assert.equal(readScreamingFrogIssues({ attachments: [] }), null)
  assert.equal(readScreamingFrogIssues(null), null)
})

test('PDF Semrush: valore sulla stessa riga dell’etichetta', () => {
  const r = parseSemrushPdfText('Site Health 90%\nAI Search Health 99%\nErrors 1\nWarnings 4\n')
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.parsed.site_health, 90)
    assert.equal(r.extra.ai_search_health, 99)
  }
})
