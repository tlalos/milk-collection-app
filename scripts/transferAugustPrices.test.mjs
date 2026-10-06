import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { MONTH, validateRows, validateSnapshot, planImport, updateSql, insertSql } from './transferAugustPrices.mjs'

const row = { monthKey: MONTH, producerCode: 'p001', milkType: 'MILK-COW', responsiblePrice: '1.5000', producerName: 'Example', centerCode: 'c001', centerName: 'Center' }
const snapshot = rows => ({ formatVersion: 1, sourceTable: 'dbo.MonthlyProducerPricing', source: { serverName: 'local', databaseName: 'milk' }, month: MONTH,
  fields: ['responsiblePrice'], rowCount: rows.length, rows, checksum: createHash('sha256').update(JSON.stringify(rows)).digest('hex') })

test('only August 2026 is accepted, even if another month has a valid checksum', () => {
  validateSnapshot(snapshot([row]))
  for (const monthKey of ['2026-07', '2026-09', '2025-08']) {
    assert.throws(() => validateSnapshot(snapshot([{ ...row, monthKey }])), /Only August/)
  }
})
test('snapshot checksum, field scope, duplicate keys and invalid values are rejected', () => {
  const changed = snapshot([row]); changed.rows = [{ ...row, responsiblePrice: '2.00' }]
  assert.throws(() => validateSnapshot(changed), /Invalid or changed/)
  assert.throws(() => validateRows([{ ...row, electricity: 15 }]), /Unexpected/)
  assert.throws(() => validateRows([row, { ...row, producerCode: 'P001' }]), /Duplicate/)
  for (const responsiblePrice of [null, '', -1, 'NaN', '1.12345', '1000001']) assert.throws(() => validateRows([{ ...row, responsiblePrice }]), /Invalid base/)
  assert.throws(() => validateRows([]), /No August/)
})
test('previous and subsequent month prices do not match August and are not changed', () => {
  const previous = [{ ...row, monthKey: '2026-07', responsiblePrice: '2.0' }, { ...row, monthKey: '2026-09', responsiblePrice: '3.0' }]
  const before = structuredClone(previous)
  const plan = planImport([row], previous, [])
  assert.equal(plan.insert.length, 1)
  assert.equal(plan.update.length, 0)
  assert.deepEqual(previous, before)
})
test('same prices are skipped, including submitted invoices', () => {
  const plan = planImport([row], [{ ...row, responsiblePrice: 1.5 }], [{ ...row, status: 'SENT' }])
  assert.equal(plan.unchanged.length, 1)
  assert.equal(plan.conflicts.length, 0)
})
test('only missing prices are filled by default; different existing prices need explicit replacement', () => {
  assert.equal(planImport([row], [{ ...row, responsiblePrice: null }], []).update.length, 1)
  assert.equal(planImport([row], [{ ...row, responsiblePrice: '2.0' }], []).conflicts.length, 1)
  assert.equal(planImport([row], [{ ...row, responsiblePrice: '2.0' }], [], true).update.length, 1)
})
test('locked and legacy invoices block all price changes even with replacement enabled', () => {
  for (const status of ['SENT', 'SENDING', 'UNCONFIRMED', 'UNKNOWN']) {
    for (const milkType of ['MILK-COW', '']) {
      assert.equal(planImport([row], [], [{ ...row, milkType, status }], true).conflicts.length, 1)
    }
  }
  assert.equal(planImport([row], [], [{ ...row, status: 'DRAFT' }]).insert.length, 1)
  assert.equal(planImport([row], [], [{ ...row, monthKey: '2026-07', status: 'SENT' }]).insert.length, 1)
})
test('two milk types remain separate and an invoice locks only its matching type', () => {
  const sheep = { ...row, milkType: 'MILK-SHEEP' }
  const plan = planImport([row, sheep], [], [{ ...row, status: 'SENT' }])
  assert.equal(plan.conflicts.length, 1)
  assert.deepEqual(plan.insert, [sheep])
})
test('zero is a valid price and full four-decimal precision is compared', () => {
  validateRows([{ ...row, responsiblePrice: '0.0000' }])
  assert.equal(planImport([row], [{ ...row, responsiblePrice: '1.5001' }], []).conflicts.length, 1)
})
test('SQL independently fixes August and never updates commission, electricity, comments or invoices', () => {
  assert.match(updateSql, /WHERE monthKey = '2026-08' AND producerCode = @producerCode AND milkType = @milkType/)
  assert.match(insertSql, /VALUES \('2026-08',/)
  for (const statement of [updateSql, insertSql]) assert.doesNotMatch(statement, /DELETE|MERGE|receiverCommission|electricity|responsibleComment|MonthlyInvoices/)
})
