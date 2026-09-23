import test from 'node:test'
import assert from 'node:assert/strict'
import { desiredDailyAvizLinks, reconciliationKey } from './dailyReconciliationMatch.js'

const reception = (overrides = {}) => ({
  receptionId: 'REC-1', receptionDate: '2026-09-10', vehicleRegistration: 'MS-33-MRN',
  vehicleCategory: 'COLLECTION', routeId: 'R20', ...overrides,
})
const job = (overrides = {}) => ({
  id: 'JOB-1', documentCategory: 'daily_routes', status: 'completed', reviewStatus: 'reviewed',
  data: { date: '2026-09-10', vehicleRegistration: 'MS 33 MRN', route: 'r-20', rows: [{ rowNumber: 1 }, { rowNumber: 2 }] },
  ...overrides,
})

test('links every line of a reviewed daily aviz to one exact COLLECTION reception', () => {
  assert.equal(reconciliationKey('10/09/2026', 'MS-33-MRN', 'R20'), '2026-09-10|MS33MRN|R20')
  assert.deepEqual(desiredDailyAvizLinks([reception()], [job()]), [
    { jobId: 'JOB-1', rowIndex: 0, rowNumber: 1, receptionId: 'REC-1', documentDate: '2026-09-10' },
    { jobId: 'JOB-1', rowIndex: 1, rowNumber: 2, receptionId: 'REC-1', documentDate: '2026-09-10' },
  ])
})

test('never links OTHER receptions, even with the same date, truck and route', () => {
  assert.deepEqual(desiredDailyAvizLinks([reception({ vehicleCategory: 'OTHER' })], [job()]), [])
})

test('leaves ambiguous keys and unreviewed jobs unlinked', () => {
  assert.deepEqual(desiredDailyAvizLinks([reception(), reception({ receptionId: 'REC-2' })], [job()]), [])
  assert.deepEqual(desiredDailyAvizLinks([reception()], [job({ reviewStatus: 'pending' })]), [])
  assert.deepEqual(desiredDailyAvizLinks([reception()], [job({ status: 'queued' })]), [])
})

test('requires all three key fields and respects the requested dates', () => {
  assert.deepEqual(desiredDailyAvizLinks([reception()], [job({ data: { date: '2026-09-10', vehicleRegistration: 'MS-33-MRN', route: '', rows: [{}] } })]), [])
  assert.deepEqual(desiredDailyAvizLinks([reception()], [job()], ['2026-09-11']), [])
})

test('a liters difference does not block linking, but a changed route does', () => {
  const differentLiters = job({ data: { date: '2026-09-10', vehicleRegistration: 'MS-33-MRN', route: 'R20', rows: [{ rowNumber: 1, liters: 999999 }] } })
  assert.equal(desiredDailyAvizLinks([reception()], [differentLiters]).length, 1)
  const changedRoute = job({ data: { ...differentLiters.data, route: 'R03' } })
  assert.deepEqual(desiredDailyAvizLinks([reception()], [changedRoute]), [])
})
