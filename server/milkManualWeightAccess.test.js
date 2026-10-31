import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { assertScaleOnlyReceptionWeights } from './receptionWeightHistory.js'
import { assertScaleOnlyDeliveryWeights } from './deliveryWeightHistory.js'

for (const kind of ['Reception', 'Delivery']) {
  for (const operation of ['create', 'update']) {
    test(`${operation} ${kind} permits manual weights only with the trusted server override`, async () => {
      const source = await readFile(new URL(`./milk${kind}Store.js`, import.meta.url), 'utf8')
      const ast = ts.createSourceFile('store.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      const name = `${operation}Milk${kind}`
      const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast).replace(/^export /u, '')
      const weight = kind === 'Reception' ? { fullTruckWeightKg: 8000, fullTruckWeightSource: 'MANUAL', fullTruckWeighedAt: null }
        : { loadedWeightKg: 8000, loadedWeightSource: 'MANUAL', loadedWeighedAt: null }
      const record = { ...weight, deliveryDate: '2026-10-31', milkType: 'MILK-COW' }
      const passed = new Error('Reached transaction after validation')
      const context = {
        assertCurrentMilkDateAccess() {}, assertMilkDocumentDate() {}, currentMilkDate: () => '2026-10-31',
        [`initializeMilk${kind}Store`]: async () => {}, [`getMilk${kind}`]: async () => ({ milkType: 'MILK-COW' }),
        getPool: async () => ({}), getMilkDensityFactor: async () => ({ densityFactor: 1.03, label: 'Cow' }),
        [`normalize${kind}`]: () => ({ ...record }), assertScaleOnlyReceptionWeights, assertScaleOnlyDeliveryWeights,
        assertUniqueReceptionCombination: async () => {}, nextReceptionId: async () => 'test',
        randomUUID: () => 'test-id', validateDelivery() {}, sql: { Transaction: class { constructor() { throw passed } } },
      }
      vm.createContext(context)
      vm.runInContext(fn, context)
      const input = { ...record, allowManualWeights: true, isAdmin: true }
      const invoke = allow => operation === 'create' ? context[name](input, 'test', false, allow)
        : context[name]('test', input, 'test', false, allow)
      await assert.rejects(() => invoke(undefined), /scale button/)
      await assert.rejects(() => invoke(false), /scale button/)
      await assert.rejects(() => invoke(true), error => error === passed)
    })
  }
}
