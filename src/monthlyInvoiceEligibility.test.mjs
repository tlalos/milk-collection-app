import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const built = await build({ entryPoints: ['src/monthlyInvoiceEligibility.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { monthlyInvoiceBlockReason: reason, monthlyInvoiceSeries } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const row = { producerCode: 'p0001', readyForPricing: true, reconciliationStatus: 'ok', reconciliationDifferenceLiters: 0 }

test('Bool2 selects invoice series without defaulting unknown values', () => {
  assert.equal(monthlyInvoiceSeries('0'), 5106)
  assert.equal(monthlyInvoiceSeries('1'), 5105)
  assert.equal(monthlyInvoiceSeries(' 1 '), 5105)
  for (const value of [undefined, null, '', '2', 'unknown']) assert.equal(monthlyInvoiceSeries(value), null)
})

test('final amount is required, but a milk price is not', () => {
  assert.equal(reason(row, 120, true), null)
  assert.equal(reason(row, 0, true), null)
  assert.equal(reason(row, null, true), 'No final result')
  assert.equal(reason(row, NaN, true), 'No final result')
})
test('five liter tolerance is inclusive and symmetric', () => {
  for (const diff of [-5, 0, 5]) assert.equal(reason({ ...row, reconciliationDifferenceLiters: diff }, 100, true), null)
  for (const diff of [-5.001, 5.001, 10]) assert.equal(reason({ ...row, reconciliationDifferenceLiters: diff }, 100, true), 'Difference exceeds 5 L')
})
test('producer and document problems block sending', () => {
  for (const change of [{ producerWarning: 'Wrong center' }, { producerCode: '' }, { duplicateProducer: true }, { missingLiters: true }, { approvalReviewRequired: true }, { reconciliationStatus: 'missing_aviz' }, { reconciliationDifferenceLiters: null }, { readyForPricing: false }]) {
    assert.ok(reason({ ...row, ...change }, 100, true))
  }
  assert.equal(reason(row, 100, false), 'No ERP match')
})
test('approved aviz bypasses missing journal comparison but not producer problems', () => {
  const approved = { ...row, source: 'aviz', reconciliationStatus: 'missing_monthly', reconciliationDifferenceLiters: null }
  assert.equal(reason(approved, 100, true), null)
  assert.ok(reason({ ...approved, approvalReviewRequired: true }, 100, true))
  assert.ok(reason({ ...approved, producerWarning: 'No ERP match' }, 100, true))
})
