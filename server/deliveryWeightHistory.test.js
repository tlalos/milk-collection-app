import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveryWeightEvents } from './deliveryWeightHistory.js'

test('records initial manual delivery weights separately', () => {
  assert.deepEqual(deliveryWeightEvents(null, {
    loadedWeightKg: 8500, loadedWeightSource: 'MANUAL', loadedWeighedAt: null,
    emptyWeightKg: 3000, emptyWeightSource: 'MANUAL', emptyWeighedAt: null,
  }).map(({ weightKind, source, previousWeightKg, scaleCapturedAt }) => ({ weightKind, source, previousWeightKg, scaleCapturedAt })), [
    { weightKind: 'LOADED', source: 'MANUAL', previousWeightKg: null, scaleCapturedAt: null },
    { weightKind: 'EMPTY', source: 'MANUAL', previousWeightKg: null, scaleCapturedAt: null },
  ])
})

test('records a scale reading even when the weight is unchanged', () => {
  const before = { loadedWeightKg: 8500, loadedWeightSource: 'SCALE', loadedWeighedAt: '2026-09-28T09:00:00' }
  const events = deliveryWeightEvents(before, before, { loadedScaleCaptureId: 'reading-2' })
  assert.equal(events.length, 1)
  assert.equal(events[0].source, 'SCALE')
  assert.equal(events[0].captureId, 'reading-2')
  assert.equal(events[0].scaleCapturedAt, '2026-09-28T09:00:00')
})

test('manual correction removes current scale provenance while keeping the previous source', () => {
  const events = deliveryWeightEvents(
    { loadedWeightKg: 8500, loadedWeightSource: 'SCALE', loadedWeighedAt: '2026-09-28T09:00:00' },
    { loadedWeightKg: 8600, loadedWeightSource: 'MANUAL', loadedWeighedAt: null },
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].source, 'MANUAL')
  assert.equal(events[0].previousSource, 'SCALE')
  assert.equal(events[0].scaleCapturedAt, null)
  assert.deepEqual(deliveryWeightEvents(
    { loadedWeightKg: 8600, loadedWeightSource: 'MANUAL', loadedWeighedAt: null },
    { loadedWeightKg: 8600, loadedWeightSource: 'MANUAL', loadedWeighedAt: null },
  ), [])
})

test('unrelated saves do not add delivery weight history', () => {
  const before = { loadedWeightKg: 8500, loadedWeightSource: 'MANUAL', loadedWeighedAt: null }
  assert.deepEqual(deliveryWeightEvents(before, { ...before, aviz: 'AV-123' }), [])
})

test('clearing a delivery weight is recorded as a manual change', () => {
  const events = deliveryWeightEvents(
    { emptyWeightKg: 3000, emptyWeightSource: 'SCALE', emptyWeighedAt: '2026-09-28T09:10:00' },
    { emptyWeightKg: null, emptyWeightSource: null, emptyWeighedAt: null },
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].weightKind, 'EMPTY')
  assert.equal(events[0].source, 'MANUAL')
  assert.equal(events[0].weightKg, null)
  assert.equal(events[0].previousSource, 'SCALE')
})
