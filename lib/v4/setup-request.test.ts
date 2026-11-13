/** Run: npx tsx --test lib/v4/setup-request.test.ts */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SetupBody, analysisColumnsFromSetup } from '@/lib/v4/setup-request'
const site = { site_ref: 'client' as const, domain: 'moncler.com', name: 'Cliente', is_client: true, brand_name: 'Moncler' }
const base = { client: { domain: 'moncler.com', brandName: 'Moncler' }, competitors: [] }

test('jhOrganizationId is written only when the caller sent the field', () => {
  const without = analysisColumnsFromSetup(SetupBody.parse(base), site, [], null)
  assert.equal('jh_organization_id' in without, false, 'an older client must not wipe the id')

  const withId = analysisColumnsFromSetup(
    SetupBody.parse({ ...base, jhOrganizationId: '  m1798kc33zpbte60wwgpq1v1md8haxkn ' }),
    site,
    [],
    null,
  )
  assert.equal(withId.jh_organization_id, 'm1798kc33zpbte60wwgpq1v1md8haxkn')
})

test('an empty or null jhOrganizationId clears the link', () => {
  for (const v of ['', '   ', null]) {
    const cols = analysisColumnsFromSetup(SetupBody.parse({ ...base, jhOrganizationId: v }), site, [], null)
    assert.equal(cols.jh_organization_id, null, JSON.stringify(v))
  }
})
