import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { deliveryLiters, isKgOnlyDelivery } from './milkDeliveryQuantity.js'
import { prepareDeliveryArrival } from './milkDeliveryArrival.js'
import { deliveryColumns, validateMilkDeliverySnapshot } from './milkDeliveryTransfer.js'

test('kg-only quantities never contribute liters, regardless of stored factor', () => {
  for (const code of ['WHEY', 'LACTOSE', ' whey ']) {
    assert.equal(isKgOnlyDelivery(code), true)
    for (const kg of [0, 1000, null]) for (const factor of [1, 1.029]) assert.equal(deliveryLiters(code, kg, factor), null)
  }
  assert.ok(Math.abs(deliveryLiters('MILK-COW', 1029, 1.029) - 1000) < 0.000001)
  assert.equal(deliveryLiters('MILK-SHEEP', 1036, 1.036), 1000)
  assert.equal(deliveryLiters('MILK-COW', 0, 1.029), 0)
  assert.equal(deliveryLiters('MILK-COW', null, 1.029), null)
  const quantities = ['MILK-COW', 'WHEY', 'LACTOSE'].map(code => deliveryLiters(code, 1000, 1))
  assert.equal(quantities.reduce((sum, liters) => sum + (liters ?? 0), 0), 1000)
})

const source = ts.createSourceFile('store.js', readFileSync(new URL('./milkDeliveryStore.js', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const functions = source.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(source).replace(/^export /, '')).join('\n')
const context = { deliveryLiters, isKgOnlyDelivery, currentMilkDate: () => '2026-10-27', resolveReceptionWeightSource: () => ({ source: 'MANUAL', weighedAt: null }) }
vm.createContext(context)
vm.runInContext(functions, context)

test('delivery normalization clears stale liters, preserves kg calculations, and supports type changes', () => {
  const input = { deliveryDate: '2026-10-27', loadedWeightKg: 3000, emptyWeightKg: 1000, greeceWeight: 1990, densityFactor: 1, calculatedLiters: 2000 }
  for (const milkType of ['WHEY', 'LACTOSE']) {
    const row = context.normalizeDelivery({ ...input, milkType })
    assert.equal(row.calculatedLiters, null)
    assert.equal(row.netQuantityKg, 2000)
    assert.equal(row.differenceAmount, -10)
    assert.equal(context.rowToDelivery({ ...row, calculatedLiters: 999 }).calculatedLiters, null)
    const arrival = prepareDeliveryArrival({ ...row, status: 'AWAITING_GREECE' }, { greeceWeight: 1980, invoiceNumber: 'INV', status: 'COMPLETE' })
    assert.equal(arrival.netQuantityKg, 2000)
    assert.equal(arrival.calculatedLiters, null)
    assert.equal(context.normalizeDelivery({ ...arrival, milkType: 'MILK-COW', densityFactor: 1 }).calculatedLiters, 2000)
  }
})

test('snapshot imports reject liters for kg-only products', () => {
  const row = { ...Object.fromEntries(deliveryColumns.map(key => [key, null])), deliveryId: 'test', deliveryDate: '2026-10-27', status: 'DRAFT' }
  for (const milkType of ['WHEY', 'LACTOSE']) {
    assert.doesNotThrow(() => validateMilkDeliverySnapshot([{ ...row, milkType }]))
    for (const calculatedLiters of [0, 1000]) assert.throws(() => validateMilkDeliverySnapshot([{ ...row, milkType, calculatedLiters }]), /must not contain liters/)
  }
})
