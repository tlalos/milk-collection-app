import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultMilkDensitySettings, validateMilkDensitySettings } from './milkDensitySettingsStore.js'

function settings() {
  return Object.fromEntries(Object.entries(defaultMilkDensitySettings).map(([workflow, entries]) => [
    workflow,
    entries.map(({ code, densityFactor }) => ({ code, densityFactor })),
  ]))
}

test('keeps reception and deliveries factors independent', () => {
  const input = settings()
  input.RECEPTION[0].densityFactor = 1.031
  const result = validateMilkDensitySettings(input)
  assert.equal(result.RECEPTION[0].densityFactor, 1.031)
  assert.equal(result.DELIVERIES[0].densityFactor, 1.029)
})

test('requires every known milk type exactly once', () => {
  const missing = settings()
  missing.RECEPTION.pop()
  assert.throws(() => validateMilkDensitySettings(missing), /required/)

  const duplicated = settings()
  duplicated.DELIVERIES[1].code = duplicated.DELIVERIES[0].code
  assert.throws(() => validateMilkDensitySettings(duplicated), /Duplicate/)
})

test('rejects out-of-range or excessive-precision values', () => {
  for (const invalid of [0, 1.201, 1.0234567, NaN]) {
    const input = settings()
    input.RECEPTION[0].densityFactor = invalid
    assert.throws(() => validateMilkDensitySettings(input), /Invalid density factor/)
  }
})
