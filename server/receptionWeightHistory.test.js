import test from 'node:test'
import assert from 'node:assert/strict'
import { receptionWeightEvents, assertScaleOnlyReceptionWeights } from './receptionWeightHistory.js'

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

for (const prefix of ['fullTruck', 'emptyTruck']) {
  test(`${prefix} rejects new manual weights, overrides, clearing and incomplete scale metadata`, () => {
    const weight = `${prefix}WeightKg`, source = `${prefix}WeightSource`
    const time = `${prefix}WeighedAt`, capture = `${prefix}ScaleCaptureId`
    const before = { [weight]: 8000, [source]: 'SCALE', [time]: '2026-10-15T10:00:00' }
    const after = { [weight]: 8100, [source]: 'SCALE', [time]: '2026-10-15T10:01:00' }
    const rejects = (old, next, input = {}) => assert.throws(() => assertScaleOnlyReceptionWeights(old, next, input), error => error.status === 400 && /scale button/.test(error.message))
    rejects(null, { [weight]: 8000, [source]: 'MANUAL' })
    rejects(before, { ...after, [source]: 'MANUAL' }, { [capture]: 'capture-1' })
    rejects(before, { [weight]: null, [source]: null, [time]: null })
    rejects(before, after)
    rejects(before, { ...after, [time]: null }, { [capture]: 'capture-1' })
    rejects(before, after, { [capture]: ' '.repeat(3) })
    assert.doesNotThrow(() => assertScaleOnlyReceptionWeights(null, after, { [capture]: 'capture-1' }))
    assert.doesNotThrow(() => assertScaleOnlyReceptionWeights(before, after, { [capture]: 'capture-2' }))
  })
}

test('scale-only validation preserves legacy weights and permits unrelated edits', () => {
  for (const source of ['MANUAL', 'SCALE', null]) {
    const before = { fullTruckWeightKg: 8000, fullTruckWeightSource: source, fullTruckWeighedAt: source === 'SCALE' ? '2026-10-15T10:00:00' : null }
    assert.doesNotThrow(() => assertScaleOnlyReceptionWeights(before, { ...before, comments: 'Checked', emptyTruckWeightKg: null }))
  }
  assert.doesNotThrow(() => assertScaleOnlyReceptionWeights(null, { fullTruckWeightKg: null, emptyTruckWeightKg: null }))
})
