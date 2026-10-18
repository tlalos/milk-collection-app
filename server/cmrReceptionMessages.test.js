import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { cmrReceptionMessages, dailyAvizReceptionMessages, registerCmrReceptionMessages, receptionMessageMonths } from './cmrReceptionMessages.js'
import { createPermissionMiddleware } from './permissionMiddleware.js'

const job = { id: 'cmr', documentCategory: 'cmr', status: 'completed', reviewStatus: 'pending',
  data: { date: '2026-09-23', truckNumber: 'MS-33-MRN', supplier: 'Supplier', quantity: 4900, quantityUnit: 'L', avizNumber: '00168' }, secret: 'not public' }
const row = { receptionId: 'r1', vehicleCategory: 'OTHER', receptionDate: '2026-09-23', vehicleRegistration: 'ms 33 mrn', fullTruckWeightKg: 7000, emptyTruckWeightKg: 2000, netQuantityKg: 5000 }
const link = { jobId: job.id, receptionId: row.receptionId, status: 'CONFIRMED' }
test('Reception messages use two calendar months including year and local midnight boundaries', () => {
  assert.deepEqual(receptionMessageMonths(new Date('2026-10-18T12:00:00Z')), ['2026-10', '2026-09'])
  assert.deepEqual(receptionMessageMonths(new Date('2026-12-31T22:30:00Z')), ['2027-01', '2026-12'])
  assert.deepEqual(receptionMessageMonths(new Date('2026-08-31T21:30:00Z')), ['2026-09', '2026-08'])
})
const aviz = { id: 'aviz', documentCategory: 'daily_routes', status: 'completed', reviewStatus: 'reviewed',
  data: { date: '23/09/2026', vehicleRegistration: 'MS-33-MRN', route: 'R-201', rows: [{ noticeNumber: '00012', liters: 100 }, { noticeNumber: '00013', liters: 50 }] } }
const collection = { ...row, vehicleCategory: 'COLLECTION', routeId: 'r 201' }
test('Daily Aviz messages require collection date, normalized truck and route, and clear after weighing', () => {
  const run = (rows = [], doc = aviz) => dailyAvizReceptionMessages([doc], rows)
  assert.equal(run()[0].kind, 'missing_reception')
  assert.equal(run()[0].documentType, 'daily_aviz')
  assert.equal(run()[0].receptionDate, '2026-09-23')
  assert.equal(run()[0].quantity, 150)
  assert.equal(run()[0].unit, 'L')
  assert.equal(run()[0].avizNumber, '00012, 00013')
  assert.equal(run([{ ...collection, vehicleCategory: 'OTHER' }])[0].kind, 'missing_reception')
  assert.equal(run([{ ...collection, routeId: 'R202' }])[0].kind, 'missing_reception')
  assert.equal(run([{ ...collection, receptionDate: '2026-09-24' }])[0].kind, 'missing_reception')
  assert.equal(run([{ ...collection, vehicleRegistration: 'MS 33 MNR' }])[0].kind, 'missing_reception')
  assert.equal(run([{ ...collection, emptyTruckWeightKg: null }])[0].kind, 'missing_weights')
  assert.equal(run([collection, { ...collection, receptionId: 'duplicate' }])[0].kind, 'multiple_receptions')
  assert.deepEqual(run([collection]), [])
  assert.deepEqual(run([collection], { ...aviz, documentCategory: undefined }), [])
  assert.equal(run([], { ...aviz, data: { ...aviz.data, rows: [{ liters: null }] } })[0].quantity, null)
  for (const patch of [{ status: 'failed' }, { status: 'queued' }, { status: 'processing' }, { documentCategory: 'journal_monthly_settlement' }, { data: { ...aviz.data, date: '' } }, { data: { ...aviz.data, route: '' } }, { data: { ...aviz.data, vehicleRegistration: '' } }]) {
    assert.deepEqual(run([], { ...aviz, ...patch }), [])
  }
})
test('CMR messages distinguish missing reception, weighing, confirmation and stale links', () => {
  const run = (rows = [], links = []) => cmrReceptionMessages([job], rows, links)
  assert.equal(run()[0].kind, 'missing_reception')
  assert.equal(run([{ ...row, vehicleCategory: 'COLLECTION' }])[0].kind, 'missing_reception')
  assert.equal(run([{ ...row, receptionDate: '2026-09-24' }])[0].kind, 'missing_reception')
  assert.equal(run([{ ...row, vehicleRegistration: 'MS 33 MNR' }])[0].kind, 'missing_reception')
  assert.equal(run([row])[0].kind, 'confirm_match')
  assert.equal(run([{ ...row, emptyTruckWeightKg: null }])[0].kind, 'missing_weights')
  assert.equal(run([{ ...row, netQuantityKg: null }], [link])[0].kind, 'missing_weights')
  assert.equal(run([row], [{ ...link, status: 'NEEDS_REVIEW' }])[0].kind, 'review_link')
  assert.deepEqual(run([row], [link]), [])
  assert.deepEqual(run([{ ...row, fullTruckWeightKg: 0, emptyTruckWeightKg: 0, netQuantityKg: 0 }], [link]), [])
  assert.equal(run([], [link])[0].kind, 'missing_reception', 'Deleted reception reappears as a message')
  assert.equal(run()[0].avizNumber, '00168')
  assert.equal(run()[0].unit, 'L')
  assert.equal('data' in run()[0], false)
  assert.equal('secret' in run()[0], false)
})
test('No missing-scale claims for unfinished OCR or documents without matching keys', () => {
  for (const patch of [{ status: 'queued' }, { status: 'processing' }, { status: 'failed' }, { documentCategory: 'daily_routes' }, { data: { ...job.data, date: '' } }, { data: { ...job.data, truckNumber: '' } }]) {
    assert.deepEqual(cmrReceptionMessages([{ ...job, ...patch }], [], []), [])
  }
  assert.equal(cmrReceptionMessages([{ ...job, reviewStatus: 'reviewed' }], [], [])[0].reviewed, true)
})
test('Message endpoint requires reception permission and queries full months, not capped history', async () => {
  const app = express()
  const { requirePermission } = createPermissionMiddleware({ sessionToken: req => req.headers.authorization,
    getSessionUser: async token => token === 'reception' ? { permissions: ['milk_reception'] } : token === 'ocr' ? { permissions: ['ocr_documents'] } : null })
  const queries = []
  registerCmrReceptionMessages(app, { requirePermission, now: () => new Date('2026-10-18T12:00:00Z'), listJobs: async () => [job, aviz,
    ...['2026-08-31', '2026-10-01', '2026-11-01'].map(date => ({ ...job, id: date, data: { ...job.data, date } })),
    { ...aviz, id: 'old-aviz', data: { ...aviz.data, date: '31/08/2026' } }],
    listMilkReceptions: async options => { queries.push(options); return options.month === '2026-09' ? [row] : [] }, listCmrReconciliationLinks: async () => [link] })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/milk-receptions/messages`
    assert.equal((await fetch(url)).status, 401)
    assert.equal((await fetch(url, { headers: { authorization: 'ocr' } })).status, 403)
    const response = await fetch(url, { headers: { authorization: 'reception' } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(queries, [{ month: '2026-09', includeQualityDetails: false }, { month: '2026-10', includeQualityDetails: false }])
    const messages = (await response.json()).messages
    assert.deepEqual(messages.map(message => message.id), ['2026-10-01', 'aviz'])
    assert.equal(messages[0].kind, 'missing_reception')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
