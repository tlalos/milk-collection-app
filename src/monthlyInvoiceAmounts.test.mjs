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
test('invalid quantities are blocked and adjusted prices are not rounded internally', () => {
  for (const qty of [0, -1, NaN]) assert.equal(calculate(qty, 1.5, 100, 100, false, false).adjustedPrice, null)
  const result = calculate(3, 1, 1, 0, false, false)
  assert.equal(result.adjustedPrice, 4 / 3)
  assert.equal(result.finalResult, 4)
})
