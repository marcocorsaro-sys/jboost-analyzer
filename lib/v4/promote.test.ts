/**
 * V4 — audit → client promotion tests (pure logic).
 *
 * Run: npx tsx --test lib/v4/promote.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildClientRowFromAudit,
  linkedClientId,
  promotedClientName,
  readPromotion,
  stampPromotion,
  type PromotableAnalysis,
} from './promote'
import { mergeV4Setup } from './setup'

const NOW = new Date('2026-08-20T10:00:00.000Z')

function audit(overrides: Partial<PromotableAnalysis> = {}): PromotableAnalysis {
  return {
    id: 'a-1',
    domain: 'client.com',
    brand_name: 'Client Brand',
    ref_date: '2026-08-01',
    client_id: null,
    industry_preset: 'retail_luxury',
    v4_setup: { sector: 'orologi di lusso' },
    ...overrides,
  }
}

test('readPromotion: empty / junk v4_setup means not promoted', () => {
  assert.deepEqual(readPromotion(null), { promotedClientId: null, promotedAt: null })
  assert.deepEqual(readPromotion({}), { promotedClientId: null, promotedAt: null })
  assert.deepEqual(
    readPromotion({ promoted_client_id: 42, promoted_at: {} }),
    { promotedClientId: null, promotedAt: null },
  )
  assert.deepEqual(
    readPromotion({ promoted_client_id: '', promoted_at: '' }),
    { promotedClientId: null, promotedAt: null },
  )
})

test('readPromotion: a stamped setup reads back', () => {
  const stamped = stampPromotion({ sector: 'x' }, 'c-9', NOW)
  assert.deepEqual(readPromotion(stamped), {
    promotedClientId: 'c-9',
    promotedAt: NOW.toISOString(),
  })
})

test('linkedClientId: promotion wins, wizard client_id is the fallback', () => {
  assert.equal(linkedClientId({ client_id: null, v4_setup: null }), null)
  assert.equal(linkedClientId({ client_id: 'c-wizard', v4_setup: {} }), 'c-wizard')
  assert.equal(
    linkedClientId({ client_id: 'c-wizard', v4_setup: { promoted_client_id: 'c-promo' } }),
    'c-promo',
  )
})

test('promotedClientName: brand first, domain fallback, null when neither', () => {
  assert.equal(promotedClientName({ brand_name: ' Client Brand ', domain: 'client.com' }), 'Client Brand')
  assert.equal(promotedClientName({ brand_name: null, domain: 'client.com' }), 'client.com')
  assert.equal(promotedClientName({ brand_name: '  ', domain: '  ' }), null)
})

test('buildClientRowFromAudit: full setup → active client row', () => {
  const res = buildClientRowFromAudit(audit(), 'user-1', NOW)
  assert.ok(res.ok)
  assert.deepEqual(res.row, {
    user_id: 'user-1',
    name: 'Client Brand',
    domain: 'client.com',
    website_url: 'https://client.com',
    industry: 'Retail / Luxury',
    lifecycle_stage: 'active',
    engagement_started_at: NOW.toISOString(),
    notes: 'Creato con "Switch to client" dall\'audit V4 (2026-08-01).',
  })
})

test('buildClientRowFromAudit: no preset → free-text sector as industry', () => {
  const res = buildClientRowFromAudit(audit({ industry_preset: null }), 'user-1', NOW)
  assert.ok(res.ok)
  assert.equal(res.row.industry, 'orologi di lusso')
})

test('buildClientRowFromAudit: unknown preset and no sector → industry null', () => {
  const res = buildClientRowFromAudit(
    audit({ industry_preset: 'not_a_preset', v4_setup: {} }),
    'user-1',
    NOW,
  )
  assert.ok(res.ok)
  assert.equal(res.row.industry, null)
})

test('buildClientRowFromAudit: no brand → the domain names the client', () => {
  const res = buildClientRowFromAudit(audit({ brand_name: null }), 'user-1', NOW)
  assert.ok(res.ok)
  assert.equal(res.row.name, 'client.com')
})

test('buildClientRowFromAudit: neither brand nor domain → refused', () => {
  const res = buildClientRowFromAudit(audit({ brand_name: null, domain: null }), 'user-1', NOW)
  assert.equal(res.ok, false)
})

test('stampPromotion: additive — existing v4_setup keys survive', () => {
  const before = { sector: 'x', attachments: [{ kind: 'crawl' }], enabled_drivers: ['authority'] }
  const after = stampPromotion(before, 'c-1', NOW)
  assert.equal(after.sector, 'x')
  assert.deepEqual(after.attachments, [{ kind: 'crawl' }])
  assert.deepEqual(after.enabled_drivers, ['authority'])
  assert.equal(after.promoted_client_id, 'c-1')
  assert.equal(after.promoted_at, NOW.toISOString())
})

test('mergeV4Setup: a wizard save after promotion keeps the stamp', () => {
  const existing = stampPromotion({ sector: 'old', attachments: [{ kind: 'crawl' }] }, 'c-1', NOW)
  const merged = mergeV4Setup(existing, { sector: 'new' })
  assert.equal(merged.sector, 'new')
  assert.deepEqual(merged.attachments, [{ kind: 'crawl' }])
  assert.equal(merged.promoted_client_id, 'c-1')
  assert.equal(merged.promoted_at, NOW.toISOString())
})
