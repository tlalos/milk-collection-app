import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prepareCorrection, validateCorrectionInput, requireInvoiceCorrectionAdmin } from './monthlyInvoiceCorrection.js'
import { changedMonthlyInvoiceSources } from './monthlyJournalInvoiceLock.js'

const admin = { isAdmin: true, username: 'test-admin' }
function fixture() {
  const invoice = { invoiceId: 'sent', monthKey: '2026-08', producerCode: 'p1', milkType: 'MILK-COW', status: 'SENT', erpId: 'ERP-1' }
  const jobs = [{ id: 'journal', documentCategory: 'journal_monthly_settlement', createdAt: '2026-09-01', data: { date: '2026-08-31', headerCenterName: 'AGRIES', milkType: 'MILK-COW', rows: [
    { rowNumber: 1, producer: 'RUS MARIA LUDOVICA', liters: 100, milkType: 'MILK-COW' }, { rowNumber: 2, producer: 'RUS MARIA', liters: 200, milkType: 'MILK-COW' },
  ] }, producerMatches: [{ rowNumber: 1, selectedCode: 'p1', selectedName: 'RUS MARIA LUDOVICA', status: 'confirmed' }] }]
  const references = { centers: [{ code: 'c1', name: 'AGRIES' }], producers: [
    { producerCode: 'p1', producerName: 'RUS MARIA LUDOVICA', centerName: 'AGRIES', centerCode: 'c1' },
    { producerCode: 'p2', producerName: 'RUS LUDOVICA MONICA PFA', centerName: 'AGRIES', centerCode: 'c1' },
  ] }
  return { invoice, invoices: [invoice], jobs, references, pricing: [], approvals: [], version: 'version' }
}
function buildRows(jobs, month) {
  return jobs.flatMap(job => job.data.rows.map(row => ({ month, producer: row.producer, producerCode: job.producerMatches.find(m => m.rowNumber === row.rowNumber)?.selectedCode || '', milkType: row.milkType,
    liters: row.liters, readyForPricing: true, center: 'AGRIES', journalRows: [{ jobId: job.id, rowNumber: row.rowNumber }] })))
}
const input = () => ({ version: 'version', producerCode: 'p2', price: 1.5, commission: 10, electricity: 5, reason: 'Corrected existing ERP invoice', confirmed: true,
  matches: [{ jobId: 'journal', rowNumber: 1, producerCode: 'p2' }, { jobId: 'journal', rowNumber: 2, producerCode: 'p1' }] })

test('correction endpoint and service require actual admin, not an assigned permission', () => {
  for (const user of [null, { username: 'user', permissions: ['app_admin', 'invoice_resolution', 'month_closure'] }, { isAdmin: 'true', username: 'user' }]) {
    let status
    requireInvoiceCorrectionAdmin({ authUser: user }, { status(value) { status = value; return this }, json() {} }, () => assert.fail('must not authorize'))
    assert.equal(status, 403)
    assert.throws(() => validateCorrectionInput(input(), user), /administrators/)
  }
  validateCorrectionInput(input(), admin)
})
test('paired journal corrections retain liters and reassign sent identity without mutating inputs', () => {
  const context = fixture(), before = structuredClone(context)
  const result = prepareCorrection(context, input(), buildRows)
  assert.equal(result.preview.producerCode, 'p2')
  assert.equal(result.preview.liters, 100)
  assert.equal(result.preview.subtotal, 165)
  assert.deepEqual(result.preview.affectedRows.map(row => [row.producerCode, row.liters]), [['p2', 100], ['p1', 200]])
  assert.deepEqual(context, before)
  assert.equal(result.changedJobs[0].producerMatches.find(m => m.rowNumber === 2).selectedName, 'RUS MARIA LUDOVICA')
  assert.equal(result.token, prepareCorrection(context, { ...input(), previewToken: result.token }, buildRows).token)
})
test('stale, uncertain, unrelated, duplicate and conflicting corrections are rejected', () => {
  assert.throws(() => prepareCorrection(fixture(), { ...input(), version: 'old' }, buildRows), /changed/)
  for (const status of ['DRAFT', 'SENDING', 'UNCONFIRMED']) {
    const context = fixture(); context.invoice.status = status
    assert.throws(() => prepareCorrection(context, input(), buildRows), /Only a sent/)
  }
  assert.throws(() => prepareCorrection(fixture(), { ...input(), matches: [{ jobId: 'other', rowNumber: 1, producerCode: 'p2' }] }, buildRows), /Invalid/)
  assert.throws(() => prepareCorrection(fixture(), { ...input(), matches: [input().matches[0], input().matches[0]] }, buildRows), /duplicate/)
  const context = fixture(); context.invoices.push({ ...context.invoice, invoiceId: 'other', producerCode: 'p2' })
  assert.throws(() => prepareCorrection(context, input(), buildRows), /Another affected/)
  context.invoices[1].status = 'DRAFT'; context.invoices[1].erpId = null; context.invoices[1].attemptCount = 1
  assert.throws(() => prepareCorrection(context, input(), buildRows), /invoice history/)
})
test('confirmation, reason and valid numeric pricing are mandatory', () => {
  for (const changes of [{ confirmed: false }, { reason: '' }, { price: null }, { price: '' }, { price: -1 }, { commission: Infinity }, { electricity: 0.00001 }, { matches: null }]) {
    assert.throws(() => validateCorrectionInput({ ...input(), ...changes }, admin))
  }
})
test('journal protection identifies changed, added, removed and rematched invoice sources', () => {
  const old = fixture().jobs[0]
  assert.deepEqual(changedMonthlyInvoiceSources(old, structuredClone(old)), [])
  const other = structuredClone(old); other.data.rows[1].liters = 250
  assert.deepEqual(changedMonthlyInvoiceSources(old, other), [])
  other.data.rows[0].liters = 250
  assert.deepEqual(changedMonthlyInvoiceSources(old, other), [{ month: '2026-08', producer: 'p1', milk: 'MILK-COW' }])
  assert.equal(changedMonthlyInvoiceSources(old, null).length, 1)
  assert.equal(changedMonthlyInvoiceSources(null, old).length, 1)
  const renamed = structuredClone(old); renamed.data.rows[0].producer = 'Other'
  assert.equal(changedMonthlyInvoiceSources(old, renamed).length, 1)
})

test('local SQL correction is atomic, preserves send history, and does not allow resend', { skip: process.env.INVOICE_SQL_TEST !== '1' }, async () => {
  await import('dotenv/config')
  assert.match(process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost', /^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/i)
  const { default: sql } = await import('mssql')
  const { monthlyInvoiceCorrection } = await import('./monthlyInvoiceCorrection.js')
  const { getMilkReceptionPool, closeMilkReceptionStore } = await import('./milkReceptionStore.js')
  const { saveMonthlyInvoiceDate, claimMonthlyInvoice, finishMonthlyInvoiceAttempt, getMonthlyInvoiceHistory } = await import('./monthlyInvoiceStore.js')
  const { upsertMonthlyProducerPricingRows, closeSqlOcrStore } = await import('./sqlOcrStore.js')
  const producerCode = `p-correction-${randomUUID()}`, month = '2098-08'
  const user = { isAdmin: true, username: 'correction-test' }
  let invoice
  const pool = await getMilkReceptionPool()
  const row = { month, producerCode, producer: 'Correction test only', milkType: 'MILK-COW', liters: 100, readyForPricing: true, center: 'TEST', journalRows: [] }
  const args = { user, buildRows: () => [row] }
  try {
    invoice = await saveMonthlyInvoiceDate({ month, producerCode, milkType: row.milkType, invoiceDate: '2098-08-31', user: user.username })
    const claim = await claimMonthlyInvoice({ invoiceId: invoice.invoiceId, invoiceDate: '2098-08-31', series: 5105, lines: [{ testOnly: true, liters: 100 }], payload: [{ testOnly: true }], user: user.username })
    await finishMonthlyInvoiceAttempt({ attemptId: claim.attemptId, erpId: `TEST-${randomUUID()}`, response: { testOnly: true } })
    const context = await monthlyInvoiceCorrection({ ...args, invoiceId: invoice.invoiceId })
    const change = { version: context.version, producerCode, matches: [], price: 1.6, commission: 10, electricity: 5, reason: 'Integration test only', confirmed: true }
    const preview = await monthlyInvoiceCorrection({ ...args, invoiceId: invoice.invoiceId, input: change })
    await assert.rejects(monthlyInvoiceCorrection({ ...args, invoiceId: invoice.invoiceId, input: { ...change, previewToken: 'bad' }, apply: true }), /Review/)
    const result = await monthlyInvoiceCorrection({ ...args, invoiceId: invoice.invoiceId, input: { ...change, previewToken: preview.previewToken }, apply: true })
    assert.equal(result.status, 'SENT')
    const history = await getMonthlyInvoiceHistory(invoice.invoiceId)
    assert.equal(history.attempts.length, 1)
    assert.equal(history.corrections.length, 1)
    assert.equal(history.corrections[0].after.price, 1.6)
    await assert.rejects(claimMonthlyInvoice({ invoiceId: invoice.invoiceId, invoiceDate: '2098-08-31', series: 5105, lines: [{}], payload: [{}], user: user.username }), /already submitted/)
    await assert.rejects(upsertMonthlyProducerPricingRows([{ monthKey: month, producerCode, milkType: row.milkType, responsiblePrice: 9 }]), { code: 'INVOICE_PRICING_LOCKED' })
    await assert.rejects(monthlyInvoiceCorrection({ ...args, invoiceId: invoice.invoiceId, input: { ...change, previewToken: preview.previewToken }, apply: true }), /changed/)
  } finally {
    if (invoice) await pool.request().input('id', sql.UniqueIdentifier, invoice.invoiceId).input('producer', sql.NVarChar(80), producerCode).query(`
      IF OBJECT_ID(N'dbo.MonthlyInvoiceCorrections',N'U') IS NOT NULL DELETE dbo.MonthlyInvoiceCorrections WHERE invoiceId=@id;
      DELETE dbo.MonthlyInvoiceAttempts WHERE invoiceId=@id; DELETE dbo.MonthlyInvoiceLines WHERE invoiceId=@id;
      DELETE dbo.MonthlyInvoices WHERE invoiceId=@id; DELETE dbo.MonthlyProducerPricing WHERE producerCode=@producer;`)
    await closeSqlOcrStore(); await closeMilkReceptionStore()
  }
})
