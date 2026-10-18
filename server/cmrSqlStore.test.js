import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizedCmrData, cmrDataFromRow, hydrateCmrJob } from './cmrSqlStore.js'
import { emptyCmrData } from './cmrDocument.js'

test('legacy kilograms migrate without assuming a delivery date or changing the amount', () => {
  const legacy = { documentType: 'cmr', supplier: 'Supplier', transport: '', driver: '', truckNumber: 'CJ 34 GDG', kilos: 1250.123456, date: '2026-10-16', avizNumber: '00123' }
  const data = normalizedCmrData(legacy)
  assert.equal(data.quantity, legacy.kilos)
  assert.equal(data.quantityUnit, 'kg')
  assert.equal(data.deliveryDate, '')
  assert.equal(data.date, legacy.date)
  assert.equal(data.avizNumber, '00123')
})

test('liters, zero and explicit missing quantities stay distinct from legacy kilograms', () => {
  for (const quantity of [4400, 0, null]) {
    const data = normalizedCmrData({ ...emptyCmrData(), quantity, quantityUnit: 'L', kilos: 999 })
    assert.equal(data.quantity, quantity)
    assert.equal(data.kilos, null)
  }
  assert.throws(() => normalizedCmrData({ ...emptyCmrData(), quantity: -1 }))
})

test('structured fields override legacy JSON and SQL dates remain calendar dates', () => {
  const job = { id: 'cmr', documentCategory: 'cmr', data: { ...emptyCmrData(), supplier: 'Old' } }
  const row = { jobJson: JSON.stringify(job), jobId: 'cmr', ...emptyCmrData(), supplier: 'Updated',
    documentDate: new Date('2026-10-16T00:00:00Z'), quantity: 4400, quantityUnit: 'L' }
  const actual = hydrateCmrJob(row)
  assert.equal(actual.data.supplier, 'Updated')
  assert.equal(actual.data.date, '2026-10-16')
  assert.equal(actual.data.kilos, null)
  assert.equal(cmrDataFromRow(row).loadingDate, '')
  assert.throws(() => hydrateCmrJob({ jobJson: JSON.stringify(job) }), /missing/i)
  assert.deepEqual(hydrateCmrJob({ jobJson: JSON.stringify({ ...job, documentCategory: 'daily_routes' }) }).data, job.data)
})
