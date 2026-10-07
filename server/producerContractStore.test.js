import test from 'node:test'
import assert from 'node:assert/strict'
import { planProducerContractImport, validateProducerContracts } from './producerContractStore.js'

const row = (overrides = {}) => ({ producerCode: 'P001', milkType: 'MILK-COW', contractNumber: '001/26', contractStartDate: '2026-06-01', contractEndDate: '2027-06-01', contractedKg: 12345.678, sourceRow: 2, ...overrides })
const producers = [{ producerCode: 'p001' }]

test('contract import normalizes producer codes without changing contract numbers or quantities', () => {
  const normalized = validateProducerContracts([row()])[0]
  assert.equal(normalized.producerCode, 'p001')
  assert.equal(normalized.contractNumber, '001/26')
  assert.equal(normalized.contractedKg, 12345.678)
})

test('invalid dates, missing numbers, precision loss and duplicate identities are rejected', () => {
  for (const invalid of [{ producerCode: '' }, { milkType: 'COW' }, { contractNumber: '' }, { contractStartDate: '2026-02-30' },
    { contractEndDate: '2025-06-01' }, { contractedKg: 0 }, { contractedKg: NaN }, { contractedKg: 1.2345 }, { sourceRow: 0 }]) {
    assert.throws(() => validateProducerContracts([row(invalid)]))
  }
  assert.throws(() => validateProducerContracts([row(), row({ producerCode: 'p001', sourceRow: 3 })]), /duplicate/)
})

test('identical imports skip all saved records, changed or overlapping contracts conflict', () => {
  const existing = validateProducerContracts([row()])
  assert.equal(planProducerContractImport([row()], existing, producers).unchanged.length, 1)
  for (const changed of [{ contractNumber: '2' }, { contractedKg: 999 }, { contractEndDate: '2028-01-01' }, { contractStartDate: '2027-06-01', contractEndDate: '2028-06-01' }]) {
    const plan = planProducerContractImport([row(changed)], existing, producers)
    assert.equal(plan.insert.length, 0)
    assert.equal(plan.conflicts.length, 1)
  }
})

test('renewals preserve previous contracts and milk types stay independent', () => {
  const existing = validateProducerContracts([row()])
  const renewal = row({ contractStartDate: '2027-06-02', contractEndDate: '2028-06-01' })
  const plan = planProducerContractImport([renewal, row({ milkType: 'MILK-SHEEP' })], existing, producers)
  assert.equal(plan.insert.length, 2)
  assert.equal(plan.conflicts.length, 0)
  assert.equal(existing.length, 1)
  assert.equal(existing[0].contractStartDate, '2026-06-01')
})

test('unknown producer codes and overlapping incoming records cannot be silently imported', () => {
  assert.equal(planProducerContractImport([row()], [], []).conflicts.length, 1)
  const plan = planProducerContractImport([row(), row({ contractStartDate: '2026-07-01', sourceRow: 3 })], [], producers)
  assert.equal(plan.conflicts.length, 1)
})
