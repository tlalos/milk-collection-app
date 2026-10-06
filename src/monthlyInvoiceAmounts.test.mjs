import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { buildInvoicePreview } from '../server/monthlyInvoiceSend.js'
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
test('invalid quantities are blocked and invoice prices retain six decimals', () => {
  for (const qty of [0, -1, NaN]) assert.equal(calculate(qty, 1.5, 100, 100, false, false).adjustedPrice, null)
  const result = calculate(3, 1, 1, 0, false, false)
  assert.equal(result.adjustedPrice, 1.333333)
  assert.equal(result.finalResult, 4)
  assert.equal(result.roundingDifference, 0)
})

test('tax follows the rounded invoice subtotal while pricing remains unchanged', () => {
  const result = calculate(963, 0, 1700, 0, true, false)
  assert.equal(pricingSubtotal(963, 0, 1700, 0), 1700)
  assert.equal(result.adjustedPrice, 1.765317)
  assert.equal(result.result, 1700)
  assert.equal(result.roundingDifference, 0)
  assert.equal(result.extraAmount, 136)
  assert.equal(result.finalResult, 1836)
  assert.equal(calculate(1, 1.005, 0, 0, false, false).adjustedPrice, 1.005)
  assert.equal(calculate(1, 1.005, 0, 0, false, false).result, 1.01)
})

test('screen, server preview and ERP payload agree for the reported rounding examples', () => {
  for (const [liters, price, commission, electricity, expected] of [
    [3947, 1.55, 500, 350, 6967.85],
    [260, 1.4, 550, 350, 1264],
    [4795, 1.6, 1000, 500, 9172],
  ]) {
    for (const [extra, regularVat] of [[true, false], [false, true], [false, false]]) {
      const result = calculate(liters, price, commission, electricity, extra, regularVat)
      const row = { month: '2026-08', producerCode: 'p1', producer: 'Example', milkType: 'MILK-COW', source: 'aviz', readyForPricing: true, liters, price, commission, electricity }
      const supplier = { sup_code: 'p1', sup_id: 1234, sup_bool01: extra ? 1 : 0, sup_bool02: 0, sup_payment: 3030, sup_vatstatusname: regularVat ? 'regular' : 'is exempted' }
      const preview = buildInvoicePreview(row, supplier, '2026-08-31', 'zg1')
      assert.equal(result.result, expected)
      assert.equal(result.roundingDifference, 0)
      assert.equal(preview.payload[0].price, result.adjustedPrice)
      assert.equal(preview.snapshot.subtotal, result.result)
      assert.equal(preview.snapshot.tax, result.extraAmount + result.vatStatusAmount)
      assert.equal(preview.snapshot.total, result.finalResult)
    }
  }
})
