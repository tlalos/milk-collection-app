import assert from 'node:assert/strict'
import test from 'node:test'
import { planMilkDeliveryImport, validateMilkDeliverySnapshot } from './milkDeliveryTransfer.js'

const row = {
  deliveryId: 'EXCEL-PASTERISATION-ROW-2', deliveryDate: '2026-06-16',
  truckNumber: 'BN-18-VLD', aviz: 'AVIZ 36', milkType: 'MILK-COW',
  loadedWeightKg: 10542, emptyWeightKg: 4520, status: 'AWAITING_GREECE',
}

test('plans missing rows without changing matching rows', () => {
  const result = planMilkDeliveryImport([row, { ...row, deliveryId: 'NEXT', aviz: 'AVIZ 37' }], [row])
  assert.deepEqual(result.unchanged, [row.deliveryId])
  assert.deepEqual(result.insert.map((item) => item.deliveryId), ['NEXT'])
  assert.deepEqual(result.conflicts, [])
})

test('stops when a production row with the same ID has different data', () => {
  const result = planMilkDeliveryImport([row], [{ ...row, loadedWeightKg: 11000 }])
  assert.deepEqual(result.conflicts, [{ deliveryId: row.deliveryId, changedFields: ['loadedWeightKg'] }])
})

test('stops when the same delivery already exists with a different ID', () => {
  const result = planMilkDeliveryImport([row], [{ ...row, deliveryId: 'PRODUCTION-ROW' }])
  assert.deepEqual(result.conflicts, [{ deliveryId: row.deliveryId, matchingId: 'PRODUCTION-ROW' }])
})

test('rejects duplicate IDs in a snapshot', () => {
  const completeRow = Object.fromEntries([
    'deliveryId', 'deliveryDate', 'deliveryTime', 'truckNumber', 'tractorNumber', 'aviz',
    'milkType', 'milkTypeLabel', 'densityFactor', 'loadedWeightKg', 'loadedWeighedAt',
    'emptyWeightKg', 'emptyWeighedAt', 'netQuantityKg', 'calculatedLiters',
    'deliveryCategory', 'departureComments', 'greeceFullWeightKg', 'greeceEmptyWeightKg',
    'greeceWeight', 'invoiceNumber', 'differenceAmount', 'arrivalComments', 'status',
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
  ].map((column) => [column, row[column] ?? null]))
  assert.throws(() => validateMilkDeliverySnapshot([completeRow, completeRow]), /Duplicate delivery ID/u)
})
