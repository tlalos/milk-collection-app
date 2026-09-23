import test from 'node:test'
import assert from 'node:assert/strict'
import { receptionWeightEvents } from './receptionWeightHistory.js'

test('unrelated autosave does not add weight history', () => {
  const weight = { fullTruckWeightKg: 8000, fullTruckWeightSource: 'SCALE', fullTruckWeighedAt: '2026-09-23T10:00:00' }
  assert.deepEqual(receptionWeightEvents(weight, { ...weight, comments: 'Checked' }), [])
})

test('manual override retains previous scale value and source', () => {
  const events = receptionWeightEvents(
    { fullTruckWeightKg: 8000, fullTruckWeightSource: 'SCALE', fullTruckWeighedAt: '2026-09-23T10:00:00' },
    { fullTruckWeightKg: 8100, fullTruckWeightSource: 'MANUAL', fullTruckWeighedAt: null },
  )
  assert.deepEqual(events, [{ weightKind: 'FULL', source: 'MANUAL', weightKg: 8100, previousWeightKg: 8000, previousSource: 'SCALE', scaleCapturedAt: null, captureId: null }])
})

test('each scale press can be recorded even if the same weight is read', () => {
  const weight = { emptyTruckWeightKg: 4000, emptyTruckWeightSource: 'SCALE', emptyTruckWeighedAt: '2026-09-23T10:00:00' }
  assert.equal(receptionWeightEvents(weight, weight).length, 0)
  assert.deepEqual(receptionWeightEvents(weight, weight, { emptyTruckScaleCaptureId: 'reading-2' })[0].captureId, 'reading-2')
})

test('clearing a weight is a manual change', () => {
  assert.equal(receptionWeightEvents({ emptyTruckWeightKg: 4000, emptyTruckWeightSource: 'SCALE' }, { emptyTruckWeightKg: null, emptyTruckWeightSource: null })[0].source, 'MANUAL')
})
