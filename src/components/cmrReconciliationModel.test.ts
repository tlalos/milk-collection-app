import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCmrReconciliation, cmrTotals, type CmrDocument, type CmrLink } from './cmrReconciliationModel.ts'
import { groupReconciliationDays, type ReceptionRow } from './dailyReconciliationModel.ts'

const reception = (patch: Partial<ReceptionRow> = {}): ReceptionRow => ({ receptionId: 'r1', receptionDate: '2026-09-23', vehicleRegistration: 'MS33MRN', vehicleCategory: 'OTHER', routeId: '', milkTypeLabel: 'Cow', driverName: 'Driver',
  fullTruckWeightKg: 7000, emptyTruckWeightKg: 2000, fullTruckWeighedAt: null, fullTruckWeightSource: null, emptyTruckWeighedAt: null, emptyTruckWeightSource: null,
  netQuantityKg: 5000, calculatedLiters: 4854.369, comments: '', ...patch })
const document = (patch: Partial<CmrDocument> = {}): CmrDocument => ({ id: 'c1', sourceFile: 'CMR.jpeg', documentDate: '2026-09-23', createdAt: '2026-09-24T12:00:00Z', vehicleRegistration: 'MS 33-MRN', supplier: 'Supplier', driver: 'Driver', avizNumber: '001', quantity: 4900, quantityUnit: 'kg', jobStatus: 'completed', reviewStatus: 'reviewed', ...patch })
const link: CmrLink = { jobId: 'c1', receptionId: 'r1', status: 'CONFIRMED' }
const build = (rows = [reception()], docs = [document()], links: CmrLink[] = []) => buildCmrReconciliation(rows, docs, links, '2026-09')

test('suggestions never pair rows or calculate differences before confirmation', () => {
  const rows = build()
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(row => row.status), ['match_available', 'match_available'])
  assert.ok(rows.every(row => row.difference === null))
  assert.equal(rows[0].documents.length, 0)
  assert.equal(rows[1].reception, null)
  assert.deepEqual(cmrTotals(rows, 'document'), { kg: 4900, L: null })
})
test('CMR-only and scale-only records remain visible; CMR-only days are grouped', () => {
  const docs = build([], [document()])
  assert.equal(docs[0].status, 'only_cmr')
  assert.equal(groupReconciliationDays([], [], [], docs)[0].date, '2026-09-23')
  assert.equal(build([reception()], [])[0].status, 'only_scale')
  assert.equal(build([reception({ vehicleCategory: 'COLLECTION' })])[0].status, 'only_cmr')
})
test('only confirmed same-key links compare in the original document unit', () => {
  const kg = build(undefined, undefined, [link])
  assert.equal(kg.length, 1); assert.equal(kg[0].difference, 100); assert.equal(kg[0].unit, 'kg')
  const liters = build(undefined, [document({ quantity: 4800, quantityUnit: 'L' })], [link])
  assert.ok(Math.abs(liters[0].difference! - 54.369) < 0.000001)
  assert.equal(liters[0].unit, 'L')
  assert.equal(build(undefined, [document({ quantity: 5000 })], [link])[0].status, 'linked')
})
test('unreviewed links, changed keys, incomplete weights and missing quantities have no difference', () => {
  for (const patch of [{ truck: true }, { status: true }]) {
    const rows = build([reception(patch.truck ? { vehicleRegistration: 'OTHER' } : {})], undefined, [{ ...link, status: patch.status ? 'NEEDS_REVIEW' : 'CONFIRMED' }])
    assert.equal(rows.length, 2); assert.ok(rows.every(row => row.difference === null && row.status === 'needs_review'))
  }
  assert.equal(build([reception({ emptyTruckWeightKg: null })], undefined, [link])[0].status, 'awaiting_weight')
  assert.equal(build(undefined, [document({ quantity: null })], [link])[0].difference, null)
  assert.equal(build(undefined, [document({ reviewStatus: 'pending' })], [link])[0].difference, null)
  assert.equal(build(undefined, [document({ documentDate: null })])[1].status, 'missing_info')
})
test('multiple candidate receptions remain unpaired; duplicate confirmed CMRs never double-count scale', () => {
  assert.ok(build([reception(), reception({ receptionId: 'r2' })]).every(row => row.difference === null))
  const rows = build(undefined, [document(), document({ id: 'c2' })], [link, { ...link, jobId: 'c2' }])
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'needs_review'); assert.equal(rows[0].difference, null)
})
test('month filtering preserves stale-link review and never invents a reception date', () => {
  assert.equal(build([], [document({ documentDate: '2026-10-23' })]).length, 0)
  const rows = build(undefined, [document({ documentDate: '2026-08-23' })], [{ ...link, status: 'NEEDS_REVIEW' }])
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'needs_review'); assert.equal(rows[0].suggestions.length, 1)
})
test('totals separate kg and liters, preserve zero and omit unavailable comparisons', () => {
  const rows = build([], [document({ quantity: 0 }), document({ id: 'c2', quantity: 100, quantityUnit: 'L' })])
  assert.deepEqual(cmrTotals(rows, 'document'), { kg: 0, L: 100 })
  assert.deepEqual(cmrTotals(rows, 'difference'), { kg: null, L: null })
  assert.deepEqual(cmrTotals(build([], [document({ quantity: null })]), 'document'), { kg: null, L: null })
})
