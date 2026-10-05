import test from 'node:test'
import assert from 'node:assert/strict'
import { validateInvoiceBatch, prepareInvoiceFromContext, previewInvoiceBatch } from './monthlyInvoiceBatch.js'
import { buildInvoicePreview } from './monthlyInvoiceSend.js'

const selection = { month: '2026-08', producerCode: 'p1', milkType: 'MILK-COW', invoiceDate: '2026-08-31' }
const row = { month: '2026-08', producerCode: 'p1', producer: 'Example', milkType: 'MILK-COW', source: 'journal', readyForPricing: true, reconciliationDifferenceLiters: 5, reconciliationStatus: 'ok', liters: 100, price: 1.5, commission: 10, electricity: 5 }
const supplier = { sup_code: 'p1', sup_id: 1234, sup_bool01: 1, sup_bool02: 0, sup_payment: 3030 }
const context = { erp: { suppliers: [supplier], username: 'zg1', params: { par_from_branch: 1, par_to_branch: 2 } }, rows: [row], invoices: [] }

test('batch selections are bounded, normalized, validated and unique per producer and milk type', () => {
  assert.equal(validateInvoiceBatch('2026-08', [{ ...selection, producerCode: ' P1 ' }])[0].producerCode, 'p1')
  assert.equal(validateInvoiceBatch('2026-08', [selection, { ...selection, milkType: 'MILK-BUFF' }]).length, 2)
  for (const selections of [[], null, Array(501).fill(selection), [selection, { ...selection, producerCode: 'P1' }], [{ ...selection, milkType: 'unknown' }], [{ ...selection, invoiceDate: '2026-02-30' }]]) {
    assert.throws(() => validateInvoiceBatch('2026-08', selections))
  }
})

test('single and batch previews use the identical ERP payload and fingerprint', () => {
  const prepared = prepareInvoiceFromContext(selection, context).preview
  assert.deepEqual(prepared, buildInvoicePreview(row, supplier, selection.invoiceDate, 'zg1', context.erp.params))
  const batch = previewInvoiceBatch([selection], context)[0]
  assert.equal(batch.fingerprint, prepared.fingerprint)
  assert.deepEqual(batch.snapshot, prepared.snapshot)
})

test('same producer with two milk types remains two separate invoice previews', () => {
  const buff = { ...selection, milkType: 'MILK-BUFF', invoiceDate: '2026-09-02' }
  const previews = previewInvoiceBatch([selection, buff], { ...context, rows: [row, { ...row, milkType: 'MILK-BUFF' }],
    invoices: [{ monthKey: '2026-08', producerCode: 'p1', milkType: 'MILK-BUFF', invoiceDate: '2026-09-02', status: 'DRAFT' }] })
  assert.equal(previews.length, 2)
  assert.ok(previews.every(preview => preview.fingerprint))
  assert.equal(previews[1].selection.invoiceDate, '2026-09-02')
  assert.notEqual(previews[0].fingerprint, previews[1].fingerprint)
})

test('submitted invoices, legacy locks, changed dates and changed pricing cannot pass preview checks', () => {
  for (const status of ['SENT', 'UNCONFIRMED', 'SENDING']) {
    for (const milkType of ['MILK-COW', '']) {
      const previews = previewInvoiceBatch([selection], { ...context, invoices: [{ monthKey: '2026-08', producerCode: 'p1', milkType, invoiceDate: '2026-08-31', status }] })
      assert.match(previews[0].error, /already submitted/)
      assert.equal(previews[0].fingerprint, undefined)
    }
  }
  assert.throws(() => prepareInvoiceFromContext({ ...selection, invoiceDate: '2026-09-01' }, context), /date changed/)
  assert.throws(() => prepareInvoiceFromContext(selection, { ...context, rows: [{ ...row, month: '2026-07' }] }))
  assert.throws(() => prepareInvoiceFromContext(selection, { ...context, rows: [{ ...row, price: null }] }), /Collector/)
  assert.notEqual(prepareInvoiceFromContext(selection, context).preview.fingerprint,
    prepareInvoiceFromContext(selection, { ...context, rows: [{ ...row, price: 2 }] }).preview.fingerprint)
})

test('one blocked row does not hide valid previews, and duplicate ERP supplier matches are rejected', () => {
  const selection2 = { ...selection, producerCode: 'p2' }
  const previews = previewInvoiceBatch([selection, selection2], context)
  assert.ok(previews[0].fingerprint)
  assert.ok(previews[1].error)
  assert.throws(() => prepareInvoiceFromContext(selection, { ...context, erp: { ...context.erp, suppliers: [supplier, supplier] } }), /one exact/)
})
