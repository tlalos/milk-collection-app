import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const built = await build({ entryPoints: ['src/monthlyInvoiceAmounts.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { pricingSubtotal, monthlyInvoiceAmounts: calculate } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)

test('commission and electricity are included once before tax', () => {
  assert.equal(pricingSubtotal(1000, 1.5, 100, 100), 1700)
  const result = calculate(1000, 1.5, 100, 100, true, true)
  assert.equal(result.adjustedPrice, 1.7)
  assert.equal(result.extraAmount, 136)
  assert.equal(result.vatStatusAmount, 0)
  assert.equal(result.finalResult, 1836)
  assert.equal(calculate(1000, 1.5, 100, 100, false, true).finalResult, 1887)
  assert.equal(calculate(1000, 1.5, 100, 100, false, false).finalResult, 1700)
})
test('collectors retain pricing subtotal but have no invoice calculation', () => {
  assert.equal(pricingSubtotal(1000, null, 100, 100), 200)
  const result = calculate(1000, null, 100, 100, true, false)
  assert.equal(result.blockReason, 'Collector procedure pending')
  assert.equal(result.adjustedPrice, null)
  assert.equal(result.finalResult, null)
  assert.equal(pricingSubtotal(1000, null, null, null), null)
})
test('invalid quantities are blocked and invoice prices use two decimals', () => {
  for (const qty of [0, -1, NaN]) assert.equal(calculate(qty, 1.5, 100, 100, false, false).adjustedPrice, null)
  const result = calculate(3, 1, 1, 0, false, false)
  assert.equal(result.adjustedPrice, 1.33)
  assert.equal(result.finalResult, 3.99)
  assert.equal(result.roundingDifference, -0.01)
})

test('tax follows the rounded invoice subtotal while pricing remains unchanged', () => {
  const result = calculate(963, 0, 1700, 0, true, false)
  assert.equal(pricingSubtotal(963, 0, 1700, 0), 1700)
  assert.equal(result.adjustedPrice, 1.77)
  assert.equal(result.result, 1704.51)
  assert.equal(result.roundingDifference, 4.51)
  assert.equal(result.extraAmount, 136.36)
  assert.equal(result.finalResult, 1840.87)
  assert.equal(calculate(1, 1.005, 0, 0, false, false).adjustedPrice, 1.01)
})
