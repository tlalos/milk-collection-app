import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { prepareDeliveryArrival } from './milkDeliveryArrival.js'

const existing = {
  deliveryDate: '2020-01-01', status: 'AWAITING_GREECE', truckNumber: 'TEST',
  netQuantityKg: 10000, loadedWeightKg: 20000, emptyWeightKg: 10000,
  greeceWeight: null, invoiceNumber: '', arrivalComments: '',
}

test('past sent deliveries accept partial arrival details and completion', () => {
  const partial = prepareDeliveryArrival(existing, { arrivalComments: ' Arrived ' })
  assert.equal(partial.arrivalComments, 'Arrived')
  assert.equal(partial.status, 'AWAITING_GREECE')
  const complete = prepareDeliveryArrival(existing, { greeceWeight: '9980,5', invoiceNumber: ' gr-1 ', status: 'COMPLETE' })
  assert.equal(complete.greeceWeight, 9980.5)
  assert.equal(complete.invoiceNumber, 'GR-1')
  assert.equal(complete.loadedWeightKg, existing.loadedWeightKg)
  assert.equal(prepareDeliveryArrival(complete, { arrivalComments: 'Corrected' }).status, 'COMPLETE')
})

test('arrival-only updates reject departure changes, draft/future rows and status resets', () => {
  for (const key of ['deliveryDate', 'truckNumber', 'aviz', 'loadedWeightKg', 'emptyWeightKg', 'loadedWeighedAt', 'loadedWeightSource', 'netQuantityKg', 'differenceAmount', 'isAdmin']) {
    assert.throws(() => prepareDeliveryArrival(existing, { [key]: 'changed' }), /Only Greece arrival/)
  }
  assert.throws(() => prepareDeliveryArrival({ ...existing, status: 'DRAFT' }, {}), error => error.status === 403)
  assert.throws(() => prepareDeliveryArrival({ ...existing, deliveryDate: '9999-01-01' }, {}), /later than today/)
  assert.throws(() => prepareDeliveryArrival(existing, { status: 'DRAFT' }), /cannot reset/)
  assert.throws(() => prepareDeliveryArrival({ ...existing, status: 'COMPLETE' }, { status: 'AWAITING_GREECE' }), /cannot reset/)
  for (const value of [null, [], 'invalid']) assert.throws(() => prepareDeliveryArrival(existing, value))
})

test('arrival completion requires a positive weight and invoice', () => {
  for (const weight of ['', null, 0, -1, 'bad', Infinity]) {
    assert.throws(() => prepareDeliveryArrival(existing, { greeceWeight: weight, invoiceNumber: 'INV', status: 'COMPLETE' }))
  }
  assert.throws(() => prepareDeliveryArrival(existing, { greeceWeight: 9000, status: 'COMPLETE' }), /Invoice number/)
  assert.throws(() => prepareDeliveryArrival(existing, { invoiceNumber: 'a'.repeat(161) }), /too long/)
})

test('arrival SQL locks the row and writes only arrival columns, without weight events', async () => {
  const source = await readFile(new URL('./milkDeliveryStore.js', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('store.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name.text === 'updateMilkDeliveryArrival')
  let queries = [], committed = false, rolledBack = false
  class Transaction {
    async begin() {}
    async commit() { committed = true }
    async rollback() { rolledBack = true }
  }
  class Request {
    input() { return this }
    async query(query) {
      queries.push(query)
      return { recordset: [{ ...existing }] }
    }
  }
  const context = {
    sql: { Transaction, Request, NVarChar: () => {}, Decimal: () => {} },
    initializeMilkDeliveryStore: async () => {}, getPool: async () => ({}),
    rowToDelivery: row => row, prepareDeliveryArrival,
  }
  vm.createContext(context)
  vm.runInContext(fn.getText(ast).replace(/^export /, ''), context)
  await context.updateMilkDeliveryArrival('test', { greeceWeight: 9980 }, 'staff')
  assert.ok(committed)
  assert.match(queries[0], /UPDLOCK, HOLDLOCK/)
  const assignments = [...queries[1].split('OUTPUT')[0].matchAll(/^\s*(\w+)\s*=/gm)].map(match => match[1])
  assert.deepEqual(assignments, ['greeceWeight', 'invoiceNumber', 'arrivalComments', 'differenceAmount', 'status', 'updatedBy', 'updatedAt'])
  assert.match(queries[1], /differenceAmount = @weight - netQuantityKg/)
  queries = []
  await assert.rejects(context.updateMilkDeliveryArrival('test', { loadedWeightKg: 1 }, 'staff'))
  assert.equal(queries.length, 1)
  assert.ok(rolledBack)
})
