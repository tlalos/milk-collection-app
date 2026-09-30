import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Bundle the real sender with isolated fake transport and connection modules.
const built = await build({
  entryPoints: ['src/store/dailyRouteErpStore.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'fake-erp', setup(build) {
    build.onResolve({ filter: /(?:api\/(?:client|itemsApi|suppliersApi|suppliesOrderApi|zgParamApi)|ocrConnectionSettingsStore)$/ }, args => ({ path: args.path, namespace: 'fake' }))
    build.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: `
      export class ApiError extends Error {}
      export const loginToErp = async () => ({ access_token: 'test', user_settings: {} });
      export const getRomOfflineItems = async () => [];
      export const getRomOfflineSuppliers = async () => [{sup_code:'c1',sup_name:'BATIN',sup_id:1}];
      export const getRomZgParam = async () => [];
      export const saveZGParalavesSuppliesOrder = async orders => globalThis.__fakeErp(orders);
      export const ocrConnectionSettingsStore = {get:()=>({serverUrl:'fake',apiUsername:'test',apiPassword:'test'})};
    ` }))
  } }],
})
const { sendDailyRouteDetailsToErp } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const data = { date: '2026-09-30', rows: [{ rowNumber: 13, collectionCenter: 'BATIN', liters: 100, noticeNumber: '3852' }] }
const matches = [{ rowNumber: 13, selectedCode: 'c1', selectedName: 'BATIN', suggestions: [] }]
const ready = kind => ({ kind, status: 'ready', manualVerification: { outcome: 'absent' }, attempts: [{ status: 'failed' }] })
const state = documents => ({ status: 'sending', recoveryId: 'test-recovery', rowLog: [
  { rowNumber: 12, status: 'sent', documents: [{ kind: 'aviz', status: 'sent', newid: '10' }, { kind: 'nir', status: 'sent', newid: '11' }] },
  { rowNumber: 13, status: 'ready', documents },
] })

test('retries only NIR and preserves successful rows and recovery history', async () => {
  const calls = []
  globalThis.__fakeErp = async orders => { calls.push(orders[0]); return { status: true, newid: '300' } }
  const original = state([{ kind: 'aviz', status: 'sent', newid: '200' }, ready('nir')])
  const result = await sendDailyRouteDetailsToErp(data, matches, undefined, async () => {}, { state: original, rowNumber: 13 })
  assert.deepEqual(calls.map(item => item.salespickingseries), [2153])
  assert.equal(result.status, 'sent')
  assert.equal(result.recoveryId, 'test-recovery')
  assert.deepEqual(result.rowLog[0], original.rowLog[0])
  assert.equal(result.rowLog[1].documents[1].attempts.length, 1)
})

test('failed Aviz prevents NIR send', async () => {
  const calls = []
  globalThis.__fakeErp = async orders => { calls.push(orders[0]); return { status: false, status_message: 'Access violation' } }
  const result = await sendDailyRouteDetailsToErp(data, matches, undefined, async () => {}, { state: state([ready('aviz'), ready('nir')]), rowNumber: 13 })
  assert.deepEqual(calls.map(item => item.salespickingseries), [5101])
  assert.equal(result.rowLog[1].documents[1].status, 'ready')
})

test('both missing documents send in Aviz then NIR order', async () => {
  const calls = []
  globalThis.__fakeErp = async orders => { calls.push(orders[0]); return { status: true, newid: String(300 + calls.length) } }
  const result = await sendDailyRouteDetailsToErp(data, matches, undefined, async () => {}, { state: state([ready('aviz'), ready('nir')]), rowNumber: 13 })
  assert.deepEqual(calls.map(item => item.salespickingseries), [5101, 2153])
  assert.equal(result.status, 'sent')
})

test('timeout remains unconfirmed and requires a new verification', async () => {
  globalThis.__fakeErp = async () => { throw new Error('timeout') }
  const result = await sendDailyRouteDetailsToErp(data, matches, undefined, async () => {}, { state: state([ready('aviz'), ready('nir')]), rowNumber: 13 })
  assert.equal(result.rowLog[1].documents[0].status, 'unconfirmed')
  await assert.rejects(sendDailyRouteDetailsToErp(data, matches, undefined, async () => {}, { state: result, rowNumber: 13 }), /verification/)
})

test('failed progress persistence prevents sending the next document', async () => {
  const calls = []
  globalThis.__fakeErp = async orders => { calls.push(orders[0]); return { status: true, newid: '300' } }
  await assert.rejects(sendDailyRouteDetailsToErp(data, matches, undefined, async progress => {
    if (progress.rowLog[1].documents[0].status === 'sent') throw new Error('SQL unavailable')
  }, { state: state([ready('aviz'), ready('nir')]), rowNumber: 13 }), /SQL unavailable/)
  assert.equal(calls.length, 1)
})
