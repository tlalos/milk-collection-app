import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveReceptionWeightSource } from './receptionWeightSource.js'

const capturedAt = '2026-09-23T10:15:00'

test('scale capture keeps its source and timestamp', () => {
  assert.deepEqual(resolveReceptionWeightSource(8000, capturedAt, 'SCALE'), { source: 'SCALE', weighedAt: capturedAt })
})

test('manual entry clears a stale scale timestamp', () => {
  assert.deepEqual(resolveReceptionWeightSource(8100, capturedAt, 'MANUAL', { weight: 8000, weighedAt: capturedAt }), { source: 'MANUAL', weighedAt: null })
  assert.deepEqual(resolveReceptionWeightSource(8100, capturedAt, 'SCALE', { weight: 8000, weighedAt: capturedAt }), { source: 'MANUAL', weighedAt: null })
})

test('old rows remain unknown after unrelated saves', () => {
  assert.deepEqual(resolveReceptionWeightSource(8000, capturedAt, null, { weight: 8000, weighedAt: capturedAt }), { source: null, weighedAt: capturedAt })
})

test('new values without a scale reading are manual', () => {
  assert.deepEqual(resolveReceptionWeightSource(8000, null, null), { source: 'MANUAL', weighedAt: null })
  assert.deepEqual(resolveReceptionWeightSource(null, capturedAt, 'SCALE'), { source: null, weighedAt: null })
})
