import test from 'node:test'
import assert from 'node:assert/strict'
import { planProducerHerdCounts, validateHerdCountEdit, checkHerdCountVersion } from './producerHerdStore.js'

const row = { producerCode: 'P001', effectiveMonth: '2026-08', cowCount: 4, buffaloCount: null, sheepGoatCount: null, sourceRows: [132, 180] }

test('herd import is idempotent and refuses same-month overwrites', () => {
  assert.equal(planProducerHerdCounts([row], []).insert[0].producerCode, 'p001')
  assert.equal(planProducerHerdCounts([row], [row]).unchanged.length, 1)
  const plan = planProducerHerdCounts([{ ...row, cowCount: 6 }], [row])
  assert.equal(plan.conflicts.length, 1)
  assert.equal(plan.insert.length, 0)
  assert.equal(planProducerHerdCounts([{ ...row, effectiveMonth: '2026-10' }], [row]).insert.length, 1)
})

test('manual edits require a producer code, valid month and typed nullable integer counts', () => {
  const input = { ...row, expectedVersion: null }
  assert.equal(validateHerdCountEdit(input).producerCode, 'p001')
  for (const changes of [{ cowCount: '' }, { cowCount: '4' }, { cowCount: undefined }, { cowCount: -1 }, { cowCount: 1.1 }, { cowCount: null }, { expectedVersion: undefined }, { expectedVersion: 'fake' }, { producerCode: '' }, { effectiveMonth: '2026-13' }]) {
    assert.throws(() => validateHerdCountEdit({ ...input, ...changes }), error => error.status === 400)
  }
  assert.equal(validateHerdCountEdit({ ...input, cowCount: 0 }).cowCount, 0)
})

test('concurrent changes and stale inherited counts cannot be overwritten', () => {
  const version = '0x000000000000000A'
  checkHerdCountVersion({ expectedVersion: null }, null)
  checkHerdCountVersion({ expectedVersion: version.toLowerCase() }, { version })
  for (const [expectedVersion, current] of [[null, { version }], [version, null], ['0x000000000000000B', { version }]]) {
    assert.throws(() => checkHerdCountVersion({ expectedVersion }, current), error => error.status === 409)
  }
})

test('herd import rejects invalid counts, months, identities and duplicates', () => {
  for (const changes of [{ cowCount: -1 }, { cowCount: 1.5 }, { cowCount: NaN }, { cowCount: 2147483648 }, { cowCount: null }, { effectiveMonth: '2026-13' }, { producerCode: '' }, { sourceRows: [] }]) {
    assert.throws(() => planProducerHerdCounts([{ ...row, ...changes }], []))
  }
  assert.throws(() => planProducerHerdCounts([row, { ...row, producerCode: 'p001' }], []), /Duplicate/)
  assert.equal(planProducerHerdCounts([{ ...row, cowCount: 0 }], []).insert.length, 1)
})
