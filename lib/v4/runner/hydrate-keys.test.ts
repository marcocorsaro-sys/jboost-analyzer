import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickKeyValue, probeKey } from './hydrate-keys'

const res = (status: number, body = '') => async () => new Response(body, { status })

test('pickKeyValue: env wins unless the provider rejected it', () => {
  assert.deepEqual(pickKeyValue('E', 'D', 'valid'), { value: 'E', source: 'env' })
  assert.deepEqual(pickKeyValue('E', 'D', 'unknown'), { value: 'E', source: 'env' })
  assert.deepEqual(pickKeyValue('E', 'D', 'rejected'), { value: 'D', source: 'db' })
})

test('pickKeyValue: same value, missing env or missing db', () => {
  assert.deepEqual(pickKeyValue('E', 'E', 'rejected'), { value: 'E', source: 'env' })
  assert.deepEqual(pickKeyValue('', 'D', 'unknown'), { value: 'D', source: 'db' })
  assert.deepEqual(pickKeyValue('E', '', 'rejected'), { value: 'E', source: 'env' })
  assert.deepEqual(pickKeyValue('', '', 'unknown'), { value: '', source: 'none' })
})

test('probeKey: Ahrefs 401 rejected, 200 valid, 5xx/throw unknown', async () => {
  assert.equal(await probeKey('AHREFS_API_KEY', 'k', res(401)), 'rejected')
  assert.equal(await probeKey('AHREFS_API_KEY', 'k', res(200, '{}')), 'valid')
  assert.equal(await probeKey('AHREFS_API_KEY', 'k', res(503)), 'unknown')
  assert.equal(
    await probeKey('AHREFS_API_KEY', 'k', async () => {
      throw new Error('net')
    }),
    'unknown',
  )
})

test('probeKey: Semrush wrong key rejected, numeric balance valid, others unknown', async () => {
  assert.equal(await probeKey('SEMRUSH_API_KEY', 'k', res(200, 'ERROR 120 :: WRONG KEY - ID PAIR')), 'rejected')
  assert.equal(await probeKey('SEMRUSH_API_KEY', 'k', res(200, '48210')), 'valid')
  assert.equal(await probeKey('SEMRUSH_API_KEY', 'k', res(200, '<html>')), 'unknown')
  assert.equal(await probeKey('SIMILARWEB_API_KEY', 'k', res(401)), 'unknown')
})
