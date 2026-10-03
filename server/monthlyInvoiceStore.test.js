import test from 'node:test'
import assert from 'node:assert/strict'
import { invoiceIdentity } from './monthlyInvoiceStore.js'
import { randomUUID } from 'node:crypto'

test('invoice identity keeps collection month separate from invoice date', () => {
  assert.deepEqual(invoiceIdentity('2026-08', ' P001 ', '2026-09-05'), {
    month: '2026-08', producerCode: 'p001', date: '2026-09-05',
  })
})

test('invalid dates, months and missing producer codes are rejected', () => {
  for (const date of ['2026-02-30', '', '05/09/2026']) assert.throws(() => invoiceIdentity('2026-08', 'p1', date))
  for (const month of ['2026-13', '', '2026-1']) assert.throws(() => invoiceIdentity(month, 'p1', '2026-08-31'))
  for (const code of ['', 'c1', 'p name']) assert.throws(() => invoiceIdentity('2026-08', code, '2026-08-31'))
})

test('SQL claim locks dates and preserves an uncertain attempt without allowing resend', { skip: process.env.INVOICE_SQL_TEST !== '1' }, async () => {
  await import('dotenv/config')
  const { saveMonthlyInvoiceDate, claimMonthlyInvoice, finishMonthlyInvoiceAttempt, unlockVerifiedAbsentInvoice } = await import('./monthlyInvoiceStore.js')
  const { getMilkReceptionPool } = await import('./milkReceptionStore.js')
  const { default: sql } = await import('mssql')
  const pool = await getMilkReceptionPool()
  let invoice
  let secondInvoice
  try {
    invoice = await saveMonthlyInvoiceDate({ month: '2099-01', producerCode: `p-test-${randomUUID()}`, milkType: 'MILK-COW', invoiceDate: '2099-01-31', user: 'invoice-storage-test' })
    secondInvoice = await saveMonthlyInvoiceDate({ month: '2099-01', producerCode: invoice.producerCode, milkType: 'MILK-BUFF', invoiceDate: '2099-02-01', user: 'invoice-storage-test' })
    assert.notEqual(secondInvoice.invoiceId, invoice.invoiceId)
    assert.equal(secondInvoice.invoiceDate, '2099-02-01')
    assert.equal(invoice.invoiceDate, '2099-01-31')
    const snapshot = { invoiceId: invoice.invoiceId, invoiceDate: '2099-01-31', series: 5105, lines: [{ liters: 10, price: 1.5 }], payload: [{ testOnly: true }], user: 'invoice-storage-test' }
    const claim = await claimMonthlyInvoice(snapshot)
    await assert.rejects(claimMonthlyInvoice(snapshot), /already submitted/)
    const secondClaim = await claimMonthlyInvoice({ ...snapshot, invoiceId: secondInvoice.invoiceId, invoiceDate: '2099-02-01' })
    assert.notEqual(secondClaim.attemptId, claim.attemptId)
    await assert.rejects(saveMonthlyInvoiceDate({ month: '2099-01', producerCode: invoice.producerCode, milkType: 'MILK-COW', invoiceDate: '2099-02-01', user: 'invoice-storage-test' }), /locked/)
    await finishMonthlyInvoiceAttempt({ attemptId: claim.attemptId, error: 'Test uncertain result; no ERP request made' })
    await assert.rejects(claimMonthlyInvoice(snapshot), /already submitted/)
    const stored = await pool.request().input('id', sql.UniqueIdentifier, invoice.invoiceId).query('SELECT status,payloadJson,error FROM dbo.MonthlyInvoiceAttempts WHERE invoiceId=@id')
    assert.equal(stored.recordset[0].status, 'UNCONFIRMED')
    assert.deepEqual(JSON.parse(stored.recordset[0].payloadJson), snapshot.payload)
    await unlockVerifiedAbsentInvoice({ invoiceId: invoice.invoiceId, attemptId: claim.attemptId, user: 'invoice-storage-test' })
    await saveMonthlyInvoiceDate({ month: '2099-01', producerCode: invoice.producerCode, milkType: 'MILK-COW', invoiceDate: '2099-02-03', user: 'invoice-storage-test' })
    const revised = { ...snapshot, invoiceDate: '2099-02-03', lines: [{ liters: 10, price: 1.6 }], payload: [{ testOnly: true, price: 1.6 }] }
    const retry = await claimMonthlyInvoice(revised)
    assert.notEqual(retry.attemptId, claim.attemptId)
    const attemptSnapshot = await pool.request().input('id', sql.UniqueIdentifier, retry.attemptId).query('SELECT snapshotJson FROM dbo.MonthlyInvoiceAttempts WHERE attemptId=@id')
    assert.equal(JSON.parse(attemptSnapshot.recordset[0].snapshotJson).invoiceDate, '2099-02-03')
    assert.deepEqual(JSON.parse(attemptSnapshot.recordset[0].snapshotJson).lines, revised.lines)
    const originalLines = await pool.request().input('id', sql.UniqueIdentifier, invoice.invoiceId).query('SELECT snapshotJson FROM dbo.MonthlyInvoiceLines WHERE invoiceId=@id')
    assert.deepEqual(JSON.parse(originalLines.recordset[0].snapshotJson), snapshot.lines[0])
    const count = await pool.request().input('id', sql.UniqueIdentifier, invoice.invoiceId).query('SELECT COUNT(*) AS n FROM dbo.MonthlyInvoiceLines WHERE invoiceId=@id')
    assert.equal(count.recordset[0].n, 1)
  } finally {
    for (const saved of [invoice, secondInvoice].filter(Boolean)) await pool.request().input('id', sql.UniqueIdentifier, saved.invoiceId).query(`
      DELETE dbo.MonthlyInvoiceAttempts WHERE invoiceId=@id;
      DELETE dbo.MonthlyInvoiceLines WHERE invoiceId=@id;
      DELETE dbo.MonthlyInvoices WHERE invoiceId=@id;`)
    await pool.close()
  }
})
