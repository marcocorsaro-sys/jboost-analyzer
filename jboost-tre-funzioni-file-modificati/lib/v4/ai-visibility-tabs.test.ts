/**
 * Run: npx tsx --test lib/v4/ai-visibility-tabs.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AnalysisSite } from '@/lib/v4/runner/types'
import { defaultTabPrompt, parseTabExtraction, readStoredTabs, buildTabExtractionPrompt } from './ai-visibility-tabs'

const SITES: AnalysisSite[] = [
  { site_ref: 'client', domain: 'moncler.com', name: 'Moncler', is_client: true, brand_name: 'Moncler' },
  { site_ref: 'competitor_1', domain: 'canadagoose.com', name: 'Canada Goose', is_client: false },
]

test('defaultTabPrompt: names every site and asks the tab-specific question', () => {
  const p = defaultTabPrompt('citations', SITES)
  assert.match(p, /moncler\.com/)
  assert.match(p, /canadagoose\.com/)
  assert.match(p, /citation rate/i)
  assert.match(p, /SOLO fonti realmente presenti/)
})

test('parseTabExtraction(sentiment): nulls become missing items, never zeros', () => {
  const json = JSON.stringify({
    sites: [{ site_ref: 'client', positive_pct: 60, neutral_pct: 30, negative_pct: 10, themes: ['qualità'] }],
    summary: 'ok',
  })
  const { extraction, error } = parseTabExtraction('sentiment', json, SITES, 'testo')
  assert.equal(error, null)
  const c1 = (extraction!.sites as Array<{ site_ref: string; positive_pct: number | null }>).find((s) => s.site_ref === 'competitor_1')!
  assert.equal(c1.positive_pct, null)
  assert.ok(extraction!.missing.some((m) => m.site_ref === 'competitor_1' && m.field === 'positive_pct'))
  assert.ok(!extraction!.missing.some((m) => m.site_ref === 'client' && m.field === 'positive_pct'))
})

test('parseTabExtraction: a percentage outside 0-100 is an error, not clamped', () => {
  const json = JSON.stringify({ sites: [{ site_ref: 'client', share_pct: 140 }] })
  const { extraction, error } = parseTabExtraction('market_share', json, SITES, 'x')
  assert.equal(extraction, null)
  assert.match(error ?? '', /share_pct/)
})

test('parseTabExtraction(citations): sources absent from the pasted text are dropped and flagged', () => {
  const pasted = 'Moncler è citato nel 40% delle risposte. Fonti: vogue.com (12 citazioni).'
  const json = JSON.stringify({
    sites: [
      {
        site_ref: 'client',
        citation_rate_pct: 40,
        sources: [
          { domain: 'https://www.vogue.com/article', count: 12 },
          { domain: 'inventata.it', count: 5 },
        ],
      },
    ],
  })
  const { extraction } = parseTabExtraction('citations', json, SITES, pasted)
  const client = (extraction!.sites as Array<{ site_ref: string; sources: Array<{ domain: string; count: number | null }> }>).find((s) => s.site_ref === 'client')!
  assert.deepEqual(client.sources, [{ domain: 'vogue.com', count: 12 }])
  assert.ok(extraction!.warnings.some((w) => /inventata\.it/.test(w)))
  assert.ok(extraction!.missing.some((m) => m.site_ref === 'competitor_1' && m.field === 'sources'))
})

test('parseTabExtraction(market_share): shares not summing to ~100 raise a warning', () => {
  const json = JSON.stringify({
    sites: [
      { site_ref: 'client', share_pct: 70 },
      { site_ref: 'competitor_1', share_pct: 70 },
    ],
  })
  const { extraction } = parseTabExtraction('market_share', json, SITES, 'x')
  assert.ok(extraction!.warnings.some((w) => /140/.test(w)))
})

test('parseTabExtraction: non-JSON output is reported, not thrown', () => {
  assert.match(parseTabExtraction('sentiment', 'boh', SITES, 'x').error ?? '', /non contiene JSON/)
})

test('buildTabExtractionPrompt: forbids invention and names the roster', () => {
  const p = buildTabExtractionPrompt('citations', 'risposta', SITES)
  assert.match(p, /NEVER invent/)
  assert.match(p, /competitor_1/)
})

test('readStoredTabs: tolerant of junk, keeps valid tabs only', () => {
  assert.deepEqual(readStoredTabs(null), {})
  const stored = readStoredTabs({ ai_visibility_tabs: { sentiment: { answer: 'a', prompt: '  ' }, bogus: {} } })
  assert.equal(stored.sentiment?.answer, 'a')
  assert.equal(stored.sentiment?.prompt, null)
  assert.equal((stored as Record<string, unknown>).bogus, undefined)
})

test('mergeV4Setup: a setup save carries the AI Visibility tabs over', async () => {
  const { mergeV4Setup } = await import('./setup')
  const tabs = { sentiment: { answer: 'a' } }
  assert.deepEqual(mergeV4Setup({ ai_visibility_tabs: tabs }, { sector: 'x' }).ai_visibility_tabs, tabs)
  assert.equal(mergeV4Setup({}, { sector: 'x' }).ai_visibility_tabs, undefined)
})
