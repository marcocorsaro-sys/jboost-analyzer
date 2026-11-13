/**
 * Run: npx tsx --test lib/v4/content-crawl.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeCrawlText, mapCrawlHeaders, matchSite, parseContentCrawlCsv, parseContentCrawlMatrix, type CrawlSite } from './content-crawl'

const SITES: CrawlSite[] = [
  { site_ref: 'client', domain: 'moncler.com', name: 'Moncler', brand_name: 'Moncler' },
  { site_ref: 'competitor_1', domain: 'canadagoose.com', name: 'Canada Goose' },
]

const HEADER = 'URL;Main content;Page title;Meta description;H1;H2;H3;Word count;GSC clicks;GSC impressions;Player;Template;Topic;Metrics source;Period;Extraction date'
const row = (url: string, tpl: string, extra = 'Moncler;') =>
  `${url};testo della pagina;Titolo;Desc;H1;H2;H3;120;10;200;${extra}${tpl};giacche;GSC;2025-10/2026-09;2026-10-13`

test('mapCrawlHeaders: accepts english and italian spellings, accents included', () => {
  const m = mapCrawlHeaders(['URL', 'Contenuto principale', 'Titolo pagina', 'N. parole', 'Clic GSC', 'Impressioni GSC', 'Player', 'Template', 'Data estrazione'])
  assert.equal(m.url, 0)
  assert.equal(m.content, 1)
  assert.equal(m.title, 2)
  assert.equal(m.word_count, 3)
  assert.equal(m.gsc_clicks, 4)
  assert.equal(m.gsc_impressions, 5)
  assert.equal(m.extraction_date, 8)
})

test('decodeCrawlText: strips the BOM, keeps accents, rejects non-UTF-8 bytes', () => {
  const ok = decodeCrawlText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('città è già', 'utf8')]))
  assert.equal(ok.text, 'città è già')
  const latin1 = decodeCrawlText(Buffer.from('città', 'latin1'))
  assert.equal(latin1.text, null)
  assert.match(latin1.error ?? '', /UTF-8/)
})

test('parseContentCrawlCsv: summarizes rows per player and template', () => {
  const lines = [HEADER]
  for (let i = 1; i <= 3; i++) lines.push(row(`https://www.moncler.com/it/p${i}`, 'pdp'))
  lines.push(row('https://www.moncler.com/it', 'homepage'))
  const r = parseContentCrawlCsv(lines.join('\n'), SITES)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.parsed.row_count, 4)
  assert.deepEqual(r.parsed.groups.map((g) => [g.site_ref, g.template, g.rows]), [
    ['client', 'homepage', 1],
    ['client', 'pdp', 3],
  ])
  assert.deepEqual(r.parsed.fields_missing, [])
  assert.deepEqual(r.parsed.warnings, [])
  assert.equal(r.parsed.char_limit, null, 'no truncation until the team decides the limit')
  assert.equal(r.parsed.content_chars.over_limit, null)
})

test('parseContentCrawlCsv: sample-size warnings (3-5 per template, 1 for the homepage)', () => {
  const lines = [HEADER, row('https://www.moncler.com/it/p1', 'pdp'), row('https://www.moncler.com/it', 'homepage'), row('https://www.moncler.com/it/h2', 'homepage')]
  const r = parseContentCrawlCsv(lines.join('\n'), SITES)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(r.parsed.warnings.some((w) => /pdp: attese 3-5 URL, trovate 1/.test(w)))
  assert.ok(r.parsed.warnings.some((w) => /homepage: attesa 1 URL, trovate 2/.test(w)))
})

test('parseContentCrawlCsv: GSC metrics without source, period or date are flagged', () => {
  const bad = 'https://www.moncler.com/it;testo;T;D;H1;H2;H3;10;5;50;Moncler;homepage;x;;;'
  const r = parseContentCrawlCsv([HEADER, bad].join('\n'), SITES)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(r.parsed.warnings.some((w) => /senza fonte, periodo o data/.test(w)))
})

test('parseContentCrawlMatrix: missing required columns is an explicit error', () => {
  const r = parseContentCrawlMatrix([['URL', 'Title'], ['https://x.com', 't']], SITES)
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.error, /content, player, template/)
})

test('parseContentCrawlMatrix: unknown players and duplicates are reported, not dropped', () => {
  const m = [
    ['URL', 'Content', 'Player', 'Template'],
    ['https://altro.it/a', 'c', 'Altro', 'faq'],
    ['https://altro.it/a', '', 'Altro', 'faq'],
  ]
  const r = parseContentCrawlMatrix(m, SITES)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.parsed.unmatched_players, ['Altro'])
  assert.equal(r.parsed.duplicate_urls, 1)
  assert.equal(r.parsed.rows_without_content, 1)
  assert.equal(r.parsed.row_count, 2)
})

test('parseContentCrawlMatrix: a configured char limit counts the pages over it', () => {
  const m = [['URL', 'Content', 'Player', 'Template'], ['https://moncler.com/a', 'x'.repeat(50), 'Moncler', 'faq']]
  const r = parseContentCrawlMatrix(m, SITES, 10)
  assert.equal(r.ok && r.parsed.content_chars.over_limit, 1)
})

test('matchSite: host first, then the player name', () => {
  assert.equal(matchSite('boh', 'https://www.canadagoose.com/it', SITES)?.site_ref, 'competitor_1')
  assert.equal(matchSite('Canada Goose', 'not a url', SITES)?.site_ref, 'competitor_1')
  assert.equal(matchSite('Cliente', '', SITES)?.site_ref, 'client')
  assert.equal(matchSite('Altro', 'https://altro.it', SITES), null)
})
