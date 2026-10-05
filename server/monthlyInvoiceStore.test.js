import test from 'node:test'
import assert from 'node:assert/strict'
import { invoiceIdentity, validateInvoiceResolution } from './monthlyInvoiceStore.js'
import { APP_PERMISSIONS, userHasPermission } from './appSecurityStore.js'
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

test('ERP resolution requires explicit verification, reason and a document ID for found invoices', () => {
  const valid = { invoiceId: randomUUID(), attemptId: randomUUID(), user: 'reviewer', outcome: 'ABSENT', confirmed: true, reason: 'Checked ERP supplier and date' }
  assert.equal(validateInvoiceResolution(valid).erpId, null)
  for (const changes of [{ confirmed: false }, { reason: '' }, { reason: ' '.repeat(4) }, { reason: 'x'.repeat(1001) }, { outcome: 'SENT' }, { user: '' }, { invoiceId: 'bad' }, { attemptId: 'bad' }, { outcome: 'FOUND' }, { outcome: 'FOUND', erpId: ' ' }, { outcome: 'FOUND', erpId: 123 }]) {
    assert.throws(() => validateInvoiceResolution({ ...valid, ...changes }))
  }
  assert.equal(validateInvoiceResolution({ ...valid, outcome: 'FOUND', erpId: ' 123 ' }).erpId, '123')
})

test('month closure access alone does not grant ERP resolution permission', () => {
  assert.ok(APP_PERMISSIONS.some(permission => permission.key === 'invoice_resolution'))
  assert.equal(userHasPermission({ permissions: ['month_closure'] }, 'invoice_resolution'), false)
  assert.equal(userHasPermission({ permissions: ['month_closure', 'invoice_resolution'] }, 'invoice_resolution'), true)
  assert.equal(userHasPermission({ isAdmin: true }, 'invoice_resolution'), true)
  assert.equal(userHasPermission(null, 'invoice_resolution'), false)
})

test('SQL claim locks dates and preserves an uncertain attempt without allowing resend', { skip: process.env.INVOICE_SQL_TEST !== '1' }, async () => {
  await import('dotenv/config')
  const { saveMonthlyInvoiceDate, saveMonthlyInvoiceDates, claimMonthlyInvoice, finishMonthlyInvoiceAttempt, unlockVerifiedAbsentInvoice, resolveMonthlyInvoice, getMonthlyInvoiceHistory } = await import('./monthlyInvoiceStore.js')
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
    const bulkRows = [invoice, secondInvoice, invoice]
    const bulk = await saveMonthlyInvoiceDates({ month: '2099-01', rows: bulkRows, invoiceDate: '2099-01-31', user: 'invoice-storage-test' })
    assert.equal(bulk.length, 2)
    assert.ok(bulk.every(row => row.invoiceDate === '2099-01-31'))
    await saveMonthlyInvoiceDate({ month: '2099-01', producerCode: invoice.producerCode, milkType: 'MILK-BUFF', invoiceDate: '2099-02-01', user: 'invoice-storage-test' })
    const snapshot = { invoiceId: invoice.invoiceId, invoiceDate: '2099-01-31', series: 5105, lines: [{ liters: 10, price: 1.5 }], payload: [{ testOnly: true }], user: 'invoice-storage-test' }
    const claim = await claimMonthlyInvoice(snapshot)
    await assert.rejects(claimMonthlyInvoice(snapshot), /already submitted/)
    const secondClaim = await claimMonthlyInvoice({ ...snapshot, invoiceId: secondInvoice.invoiceId, invoiceDate: '2099-02-01' })
    assert.notEqual(secondClaim.attemptId, claim.attemptId)
    const skipped = await saveMonthlyInvoiceDates({ month: '2099-01', rows: bulkRows, invoiceDate: '2099-02-10', user: 'invoice-storage-test' })
    assert.equal(skipped.length, 0)
    await assert.rejects(saveMonthlyInvoiceDate({ month: '2099-01', producerCode: invoice.producerCode, milkType: 'MILK-COW', invoiceDate: '2099-02-01', user: 'invoice-storage-test' }), /locked/)
    await finishMonthlyInvoiceAttempt({ attemptId: claim.attemptId, error: 'Test uncertain result; no ERP request made' })
    await assert.rejects(claimMonthlyInvoice(snapshot), /already submitted/)
    const stored = await pool.request().input('id', sql.UniqueIdentifier, invoice.invoiceId).query('SELECT status,payloadJson,error FROM dbo.MonthlyInvoiceAttempts WHERE invoiceId=@id')
    assert.equal(stored.recordset[0].status, 'UNCONFIRMED')
    assert.deepEqual(JSON.parse(stored.recordset[0].payloadJson), snapshot.payload)
    const resolution = { invoiceId: invoice.invoiceId, attemptId: claim.attemptId, user: 'invoice-storage-test', reason: 'Test: checked ERP; no document exists', confirmed: true }
    const resolutions = await Promise.allSettled([unlockVerifiedAbsentInvoice(resolution), unlockVerifiedAbsentInvoice(resolution)])
    assert.equal(resolutions.filter(result => result.status === 'fulfilled').length, 1)
    const absentHistory = await getMonthlyInvoiceHistory(invoice.invoiceId)
    assert.equal(absentHistory.invoice.status, 'DRAFT')
    assert.equal(absentHistory.attempts[0].status, 'UNCONFIRMED')
    assert.equal(absentHistory.attempts[0].outcome, 'ABSENT')
    assert.equal(absentHistory.attempts[0].resolvedBy, 'invoice-storage-test')
    assert.equal(absentHistory.attempts[0].reason, resolution.reason)
    assert.ok(absentHistory.attempts[0].resolvedAt)
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
    await finishMonthlyInvoiceAttempt({ attemptId: retry.attemptId, error: 'Test retry uncertain; no ERP request' })
    await assert.rejects(unlockVerifiedAbsentInvoice(resolution), /no longer awaiting/)
    const found = { ...resolution, attemptId: retry.attemptId, outcome: 'FOUND', erpId: `test-${randomUUID()}`, erpNumber: 'TEST-001', reason: 'Test: manually verified ERP document' }
    const linked = await resolveMonthlyInvoice(found)
    assert.equal(linked.status, 'SENT')
    const foundHistory = await getMonthlyInvoiceHistory(invoice.invoiceId)
    assert.equal(foundHistory.invoice.erpId, found.erpId)
    assert.equal(foundHistory.invoice.erpNumber, 'TEST-001')
    assert.equal(foundHistory.attempts[0].outcome, 'FOUND')
    assert.equal(foundHistory.attempts[0].reason, found.reason)
    assert.equal(foundHistory.attempts[0].error, 'Test retry uncertain; no ERP request')
    await assert.rejects(unlockVerifiedAbsentInvoice({ ...resolution, attemptId: retry.attemptId }), /Only unconfirmed/)
    await assert.rejects(resolveMonthlyInvoice(found), /Only unconfirmed/)
    await assert.rejects(claimMonthlyInvoice(revised), /already submitted/)
    await assert.rejects(saveMonthlyInvoiceDate({ ...invoice, month: '2099-01', invoiceDate: '2099-02-04', user: 'invoice-storage-test' }), /locked/)
    await finishMonthlyInvoiceAttempt({ attemptId: secondClaim.attemptId, error: 'Test only' })
    await assert.rejects(resolveMonthlyInvoice({ ...found, invoiceId: secondInvoice.invoiceId, attemptId: secondClaim.attemptId }), /already linked/)
    assert.equal((await getMonthlyInvoiceHistory(secondInvoice.invoiceId)).invoice.status, 'UNCONFIRMED')
    const secondResolution = { ...found, invoiceId: secondInvoice.invoiceId, attemptId: secondClaim.attemptId, erpId: `test-${randomUUID()}` }
    await resolveMonthlyInvoice(secondResolution)
    await assert.rejects(unlockVerifiedAbsentInvoice({ ...secondResolution, outcome: 'ABSENT' }), /Only unconfirmed/)
  } finally {
    for (const saved of [invoice, secondInvoice].filter(Boolean)) await pool.request().input('id', sql.UniqueIdentifier, saved.invoiceId).query(`
      DELETE dbo.MonthlyInvoiceResolutions WHERE invoiceId=@id;
      DELETE dbo.MonthlyInvoiceAttempts WHERE invoiceId=@id;
      DELETE dbo.MonthlyInvoiceLines WHERE invoiceId=@id;
      DELETE dbo.MonthlyInvoices WHERE invoiceId=@id;`)
    await pool.close()
  }
})
