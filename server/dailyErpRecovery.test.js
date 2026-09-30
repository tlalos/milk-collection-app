import test from 'node:test'
import assert from 'node:assert/strict'
import { dailyErpSource, prepareDailyErpRecovery } from './dailyErpRecovery.js'

function fixture() {
  const job = {
    status: 'completed', documentCategory: 'daily_routes', reviewStatus: 'reviewed',
    data: { date: '2026-09-30', rows: [{ rowNumber: 13, collectionCenter: 'BATIN', noticeNumber: '3852', liters: 100 }] },
    erpExport: { status: 'partial', rowLog: [
      { rowNumber: 12, status: 'sent', documents: [{ kind: 'aviz', status: 'sent', newid: '10' }, { kind: 'nir', status: 'sent', newid: '11' }] },
      { rowNumber: 13, center: 'BATIN', aviz: '3852', status: 'failed', documents: [{ kind: 'aviz', status: 'failed', message: 'Access violation' }, { kind: 'nir', status: 'ready' }] },
    ] },
  }
  const request = { rowNumber: 13, expectedExport: structuredClone(job.erpExport), expectedData: structuredClone(job.data), confirmedStopped: true,
    checks: { aviz: { outcome: 'absent' }, nir: { outcome: 'absent' } } }
  return { job, request }
}

test('manual absence preserves other rows and prior failure history', () => {
  const { job, request } = fixture()
  const result = prepareDailyErpRecovery(job, request)
  assert.deepEqual(result.rowLog[0], job.erpExport.rowLog[0])
  assert.equal(result.rowLog[1].documents[0].status, 'ready')
  assert.equal(result.rowLog[1].documents[0].attempts[0].message, 'Access violation')
  assert.equal(job.erpExport.rowLog[1].documents[0].status, 'failed')
  assert.ok(result.recoveryId)
})

test('existing ERP IDs complete a row without resending', () => {
  const { job, request } = fixture()
  request.checks = { aviz: { outcome: 'found', erpId: '200' }, nir: { outcome: 'found', erpId: '201' } }
  const result = prepareDailyErpRecovery(job, request)
  assert.equal(result.status, 'sent')
  assert.equal(result.successCount, 2)
  assert.equal(result.rowLog[1].documents[0].newid, '200')
})

test('successful Aviz stays untouched when only NIR needs recovery', () => {
  const { job, request } = fixture()
  job.erpExport.rowLog[1].documents[0] = { kind: 'aviz', status: 'sent', newid: '55' }
  request.expectedExport = structuredClone(job.erpExport)
  request.checks.aviz = { outcome: 'absent' }
  const result = prepareDailyErpRecovery(job, request)
  assert.deepEqual(result.rowLog[1].documents[0], job.erpExport.rowLog[1].documents[0])
})

test('stale results, changed data, and missing verification are rejected', () => {
  for (const change of [
    ({ job }) => { job.erpExport.status = 'sent' },
    ({ job }) => { job.data.rows[0].liters = 200 },
    ({ request }) => { request.confirmedStopped = false },
    ({ request }) => { request.checks.nir.outcome = '' },
    ({ request }) => { request.checks.aviz = { outcome: 'found', erpId: '' } },
  ]) {
    const fixtureData = fixture()
    change(fixtureData)
    assert.throws(() => prepareDailyErpRecovery(fixtureData.job, fixtureData.request))
  }
})

test('row changes since a recorded original send block recovery', () => {
  const { job, request } = fixture()
  job.erpExport.rowLog[1].sourceSnapshot = dailyErpSource(job.data, [], 13)
  job.data.rows[0].liters = 200
  request.expectedData = structuredClone(job.data)
  request.expectedExport = structuredClone(job.erpExport)
  assert.throws(() => prepareDailyErpRecovery(job, request), /changed since/)
})

test('legacy unresolved logs require both documents checked; legacy sent logs stay protected', () => {
  const { job, request } = fixture()
  delete job.erpExport.rowLog[1].documents
  request.expectedExport = structuredClone(job.erpExport)
  const result = prepareDailyErpRecovery(job, request)
  assert.equal(result.rowLog[1].documents[0].attempts[0].status, 'unconfirmed')
  job.erpExport.rowLog[1].status = 'sent'
  request.expectedExport = structuredClone(job.erpExport)
  assert.throws(() => prepareDailyErpRecovery(job, request), /Legacy sent/)
})
