import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDailyReconciliation,
  type AvizDocument,
  type ReceptionRow,
  type SavedLink,
} from './dailyReconciliationModel.ts'

function reception(id: string, date: string, overrides: Partial<ReceptionRow> = {}): ReceptionRow {
  return {
    receptionId: id, receptionDate: date, vehicleRegistration: 'MS-33-MRN',
    vehicleCategory: 'COLLECTION', routeId: 'R20', milkTypeLabel: 'Cow', driverName: '',
    fullTruckWeightKg: 19000, fullTruckWeighedAt: null, fullTruckWeightSource: null,
    emptyTruckWeightKg: 10000, emptyTruckWeighedAt: null, emptyTruckWeightSource: null,
    netQuantityKg: 9000, calculatedLiters: 8737.9, comments: '', ...overrides,
  }
}

function document(id: string, date: string | null, overrides: Partial<AvizDocument> = {}): AvizDocument {
  return {
    id, sourceFile: `${id}.pdf`, fileUrl: `/api/ocr/jobs/${id}/file`,
    documentDate: date, createdAt: '2026-09-09T08:00:00Z',
    vehicleRegistration: 'MS-33-MRN', route: 'R20', jobStatus: 'completed', reviewStatus: 'reviewed',
    rows: [{ rowIndex: 0, rowNumber: 1, noticeNumber: 'A1', collectionCenter: 'Center', liters: 8737.9 }],
    ...overrides,
  }
}

test('groups scale-only and aviz-only days, including documents with no parsed lines', () => {
  const result = buildDailyReconciliation(
    [reception('scale-1', '2026-09-08')],
    [document('aviz-1', '2026-09-09', { rows: [] })], [], '2026-09',
  )
  assert.deepEqual(result.days.map((day) => day.date), ['2026-09-09', '2026-09-08'])
  assert.equal(result.days[0].unmatchedAvizCount, 1)
  assert.equal(result.days[0].documentCount, 1)
  assert.equal(result.days[1].missingAvizCount, 1)
  assert.equal(result.days[1].comparisons[0].status, 'no_aviz')
})

test('compares document totals with one scale row and counts saved line links', () => {
  const links: SavedLink[] = [{ jobId: 'aviz-1', rowIndex: 0, receptionId: 'scale-1', linkedAt: null }]
  const result = buildDailyReconciliation(
    [reception('scale-1', '2026-09-09')], [document('aviz-1', '2026-09-09')], links, '2026-09',
  )
  assert.equal(result.days.length, 1)
  assert.equal(result.days[0].documentCount, 1)
  assert.equal(result.days[0].attentionCount, 0)
  assert.equal(result.comparisons[0].status, 'within_range')
  assert.equal(result.comparisons[0].savedLinkCount, 1)
  assert.equal(result.comparisons[0].differenceLiters, 0)
})

test('keeps ambiguous documents separate when two scale rows have the same key', () => {
  const result = buildDailyReconciliation(
    [reception('scale-1', '2026-09-09'), reception('scale-2', '2026-09-09')],
    [document('aviz-1', '2026-09-09')], [], '2026-09',
  )
  assert.deepEqual(result.comparisons.map((item) => item.status), ['conflict', 'conflict'])
  assert.equal(result.unmatched[0].status, 'conflict')
  assert.equal(result.days[0].unmatchedAvizCount, 1)
})

test('shows a document with a missing document date on its upload day', () => {
  const result = buildDailyReconciliation([], [document('aviz-1', null)], [], '2026-09')
  assert.equal(result.days[0].date, '2026-09-09')
  assert.equal(result.unmatched[0].status, 'missing_info')
})

test('does not match OTHER receptions to aviz documents', () => {
  const result = buildDailyReconciliation(
    [reception('other-1', '2026-09-09', { vehicleCategory: 'OTHER' })],
    [document('aviz-1', '2026-09-09')], [], '2026-09',
  )
  assert.equal(result.others.length, 1)
  assert.equal(result.comparisons.length, 0)
  assert.equal(result.unmatched[0].status, 'no_scale')
})
