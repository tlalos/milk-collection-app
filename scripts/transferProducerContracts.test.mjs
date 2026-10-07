import test from 'node:test'
import assert from 'node:assert/strict'
import { createContractSnapshot, validateContractSnapshot } from './transferProducerContracts.mjs'
import { planProducerContractImport } from '../server/producerContractStore.js'

const row = (overrides = {}) => ({ producerCode: 'p1', milkType: 'MILK-COW', contractNumber: '0001/26', contractStartDate: '2026-06-01', contractEndDate: '2027-06-01', contractedKg: 9900.125, sourceRow: 2, source: { file: 'contracts.xlsx', sheet: 'elgo', sha256: 'a'.repeat(64) }, ...overrides })
const source = { serverName: 'local', databaseName: 'milkcollection' }

test('SQL snapshot round trip preserves dates, leading zeros, precise kilograms and per-row provenance', () => {
  const rows = [row(), row({ producerCode: 'p2', source: { file: 'renewals.xlsx', sheet: 'elgo', sha256: 'b'.repeat(64) } })]
  const snapshot = JSON.parse(JSON.stringify(createContractSnapshot(rows, source)))
  assert.equal(validateContractSnapshot(snapshot).rowCount, 2)
  assert.deepEqual(snapshot.rows, rows)
})

test('changed, incomplete and wrong-table snapshots are rejected', () => {
  for (const change of [s => { s.rows[0].contractedKg = 1 }, s => { s.rowCount = 99 }, s => { s.sourceTable = 'dbo.MonthlyProducerPricing' }, s => { s.formatVersion = 2 }]) {
    const snapshot = createContractSnapshot([row()], source)
    change(snapshot)
    assert.throws(() => validateContractSnapshot(snapshot))
  }
})

test('unexpected fields, invalid source metadata and empty exports are rejected', () => {
  assert.throws(() => createContractSnapshot([row({ responsiblePrice: 1 })], source))
  assert.throws(() => createContractSnapshot([row({ source: { file: 'x', sheet: 'elgo', sha256: 'invalid' } })], source))
  assert.throws(() => createContractSnapshot([], source))
})

test('snapshot import plan is insert-only, skips identical records and protects existing contracts', () => {
  const rows = validateContractSnapshot(createContractSnapshot([row()], source)).rows
  const producers = [{ producerCode: 'p1' }]
  assert.equal(planProducerContractImport(rows, [], producers).insert.length, 1)
  assert.equal(planProducerContractImport(rows, rows, producers).unchanged.length, 1)
  assert.equal(planProducerContractImport(rows, [row({ contractedKg: 10 })], producers).conflicts.length, 1)
  assert.equal(planProducerContractImport(rows, [], []).conflicts.length, 1)
})
