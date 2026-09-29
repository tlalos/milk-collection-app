import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/store/dailyRouteErpStore.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const data = { date: '2026-09-10', route: 'R03', vehicleRegistration: 'TEST', rows: [1, 2].map(rowNumber => ({ rowNumber, collectionCenter: 'Center', liters: 100, fatPercent: 3.8, temperature: 4, noticeNumber: String(8900 + rowNumber) })) }
const matches = data.rows.map(row => ({ rowNumber: row.rowNumber, selectedCode: 'c1', suggestions: [] }))

async function run(responses, failPersistence = false) {
  const calls = [], snapshots = []
  const exports = {}
  const modules = {
    '../api/client': { ApiError: class extends Error {}, loginToErp: async () => ({ access_token: 'test', user_settings: {} }) },
    '../api/itemsApi': { getRomOfflineItems: async () => [] },
    '../api/suppliersApi': { getRomOfflineSuppliers: async () => [{ sup_code: 'c1', sup_id: 1 }] },
    '../api/zgParamApi': { getRomZgParam: async () => [] },
    './ocrConnectionSettingsStore': { ocrConnectionSettingsStore: { get: () => ({ serverUrl: 'mock', apiUsername: 'test', apiPassword: 'test' }) } },
    '../api/suppliesOrderApi': { saveZGParalavesSuppliesOrder: async ([payload]) => {
      calls.push(payload)
      const result = responses.shift()
      if (result instanceof Error) throw result
      return result
    } },
  }
  vm.runInNewContext(compiled, { exports, structuredClone, require: name => {
    assert.ok(modules[name], `Unexpected dependency ${name}`)
    return modules[name]
  } })
  const send = () => exports.sendDailyRouteDetailsToErp(data, matches, undefined, async progress => {
    snapshots.push(progress)
    if (failPersistence && progress.rowLog.some(row => row.documents.some(doc => doc.status === 'sending'))) throw new Error('SQL unavailable')
  })
  if (failPersistence) {
    await assert.rejects(send, /SQL unavailable/)
    assert.equal(calls.length, 0)
    return
  }
  return { result: await send(), calls, snapshots }
}

const ok = () => ({ status: true, newid: 'ERP-ID' })
const success = await run([ok(), ok(), ok(), ok()])
assert.equal(success.result.status, 'sent')
assert.deepEqual(success.calls.map(row => [row.salespickingseries, row.fromstore, row.tostore]), [[5101, '111', '0'], [2153, '111', '110'], [5101, '111', '0'], [2153, '111', '110']])
assert.ok(success.calls.every(row => row.setdate === '2026-09-10' && row.vatid === ''))
assert.equal(success.result.successCount, 2)
assert.ok(success.snapshots.some(state => state.rowLog[0].documents[0].status === 'sent' && state.rowLog[0].documents[1].status === 'ready'))

const partial = await run([ok(), { status: false, status_message: 'NIR rejected' }, ok(), ok()])
assert.equal(partial.result.status, 'partial')
assert.equal(partial.result.rowLog[0].documents[0].status, 'sent')
assert.equal(partial.result.rowLog[0].documents[1].status, 'failed')

const unknown = await run([new Error('Failed to fetch')])
assert.equal(unknown.calls.length, 1)
assert.equal(unknown.result.status, 'partial')
assert.equal(unknown.result.rowLog[0].documents[0].status, 'unconfirmed')
assert.equal(unknown.result.rowLog[0].documents[1].status, 'ready')
await run([], true)
console.log('Dual-send checks passed: mappings, success, partial rejection, uncertain response, persistence failure.')
