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
      export const ocrConnectionSettingsStore = {resolve:async()=>({serverUrl:'fake',apiUsername:'test',apiPassword:'test'})};
    ` }))
  } }],
})
const { dailyCenterSelectionError, failedDailyErpRecovery, sendDailyRouteDetailsToErp } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const data = { date: '2026-09-30', rows: [{ rowNumber: 13, collectionCenter: 'BATIN', liters: 100, noticeNumber: '3852' }] }
const matches = [{ rowNumber: 13, selectedCode: 'c1', selectedName: 'BATIN', suggestions: [] }]
test('center mismatch blocks repeated attempts without modifying the selection', () => {
  const wrong = [{ ...matches[0], selectedName: 'OTHER CENTER', suggestions: [{ code: 'c1', name: 'OTHER CENTER' }] }]
  const before = structuredClone(wrong)
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.match(dailyCenterSelectionError(data.rows, wrong), /Row 13:.*do not agree/)
  }
  assert.deepEqual(wrong, before)
  assert.equal(dailyCenterSelectionError(data.rows, matches), null)
  assert.match(dailyCenterSelectionError(data.rows, [{ ...matches[0], selectedName: 'OTHER' }]), /do not agree/)
  assert.match(dailyCenterSelectionError(data.rows, []), /select an ERP center/)
})
const ready = kind => ({ kind, status: 'ready', manualVerification: { outcome: 'absent' }, attempts: [{ status: 'failed' }] })

test('stale suggestions do not block a corrected name that agrees with live ERP', async () => {
  const stale = [{ ...matches[0], suggestions: [{ code: 'c1', name: 'OLD BATIN NAME' }] }]
  assert.equal(dailyCenterSelectionError(data.rows, stale), null)
  const calls = []
  globalThis.__fakeErp = async orders => { calls.push(orders[0]); return { status: true, newid: String(300 + calls.length) } }
  const result = await sendDailyRouteDetailsToErp(data, stale, undefined, async () => {}, { state: state([ready('aviz'), ready('nir')]), rowNumber: 13 })
  assert.equal(result.status, 'sent')
  assert.equal(calls.length, 2)
})

test('matching row and selection still cannot send if the live ERP name disagrees', async () => {
  let sends = 0
  globalThis.__fakeErp = async () => { sends++; return { status: true, newid: '999' } }
  const wrongData = { ...data, rows: [{ ...data.rows[0], collectionCenter: 'OTHER CENTER' }] }
  const wrongMatches = [{ ...matches[0], selectedName: 'OTHER CENTER' }]
  const result = await sendDailyRouteDetailsToErp(wrongData, wrongMatches, undefined, async () => {}, { state: state([ready('aviz'), ready('nir')]), rowNumber: 13 })
  const failed = result.rowLog.find(row => row.rowNumber === 13)
  assert.equal(failed.status, 'failed')
  assert.match(failed.message, /do not agree/)
  assert.equal(sends, 0)
})
const state = documents => ({ status: 'sending', recoveryId: 'test-recovery', rowLog: [
  { rowNumber: 12, status: 'sent', documents: [{ kind: 'aviz', status: 'sent', newid: '10' }, { kind: 'nir', status: 'sent', newid: '11' }] },
  { rowNumber: 13, status: 'ready', documents },
] })

test('preparation failure clears Sending without changing unsent documents', () => {
  const original = { status: 'sending', recoveryId: 'r', recoveryRowNumber: 13,
    rowLog: [{ rowNumber: 13, status: 'ready', documents: [ready('aviz'), ready('nir')] }] }
  const result = failedDailyErpRecovery(original, 'ERP connection is not configured.')
  assert.equal(result.status, 'failed')
  assert.equal(result.rowLog[0].status, 'failed')
  assert.equal(result.rowLog[0].documents[0].status, 'ready')
  assert.equal(result.error, 'ERP connection is not configured.')
  assert.ok(result.completedAt)
  assert.equal(original.status, 'sending')
})

test('interrupted recovery keeps sent IDs and marks only in-flight documents uncertain', () => {
  const original = state([{ kind: 'aviz', status: 'sent', newid: '200' }, { kind: 'nir', status: 'sending' }])
  original.recoveryRowNumber = 13
  const result = failedDailyErpRecovery(original, 'Connection lost')
  assert.equal(result.status, 'partial')
  assert.deepEqual(result.rowLog[0], original.rowLog[0])
  assert.equal(result.rowLog[1].documents[0].newid, '200')
  assert.equal(result.rowLog[1].documents[0].status, 'sent')
  assert.equal(result.rowLog[1].documents[1].status, 'unconfirmed')
})

test('a final save failure does not erase known ERP successes', () => {
  const original = state([{ kind: 'aviz', status: 'sent', newid: '200' }, { kind: 'nir', status: 'sent', newid: '201' }])
  original.rowLog[1].status = 'sent'
  const result = failedDailyErpRecovery(original, 'SQL unavailable')
  assert.equal(result.status, 'sent')
  assert.deepEqual(result.rowLog, original.rowLog)
})

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

test('initial row send needs no manual lookup and sends only its two documents', async () => {
  const calls = []
  globalThis.__fakeErp = async orders => { calls.push(orders[0]); return { status: true, newid: String(300 + calls.length) } }
  const original = state([{ kind: 'aviz', status: 'ready' }, { kind: 'nir', status: 'ready' }])
  original.initialRowNumber = 13
  original.rowLog.push({ rowNumber: 14, status: 'ready', neverAttempted: true, documents: [{ kind: 'aviz', status: 'ready' }, { kind: 'nir', status: 'ready' }] })
  const result = await sendDailyRouteDetailsToErp({ ...data, rows: [...data.rows, { ...data.rows[0], rowNumber: 14 }] }, matches, undefined, async () => {}, { state: original, rowNumber: 13, initial: true })
  assert.deepEqual(calls.map(item => item.salespickingseries), [5101, 2153])
  assert.deepEqual(result.rowLog[0], original.rowLog[0])
  assert.deepEqual(result.rowLog[2], original.rowLog[2])
  assert.equal(result.status, 'partial')
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
