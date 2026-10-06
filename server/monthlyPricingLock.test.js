import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

test('SQL pricing locks submitted invoices, protects legacy rows and rolls back bulk changes', { skip: process.env.INVOICE_SQL_TEST !== '1' }, async () => {
  await import('dotenv/config')
  const host = process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost'
  assert.match(host, /^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/i, 'Integration test only runs against local SQL')
  const { default: sql } = await import('mssql')
  const { saveMonthlyInvoiceDate } = await import('./monthlyInvoiceStore.js')
  const { getMilkReceptionPool, closeMilkReceptionStore } = await import('./milkReceptionStore.js')
  const { upsertMonthlyProducerPricingRows, closeSqlOcrStore } = await import('./sqlOcrStore.js')
  const pool = await getMilkReceptionPool()
  const producer = `p-lock-${randomUUID()}`
  const other = `p-lock-${randomUUID()}`
  const month = '2099-11'
  const row = { monthKey: month, producerCode: producer, producerName: 'Pricing lock test', milkType: 'MILK-COW', responsiblePrice: 1.5, receiverCommission: 10, electricity: 20, pricingStatus: 'SAVED' }
  const query = text => pool.request().input('producer', sql.NVarChar(80), producer).input('other', sql.NVarChar(80), other).query(text)
  try {
    await saveMonthlyInvoiceDate({ month, producerCode: producer, milkType: 'MILK-COW', invoiceDate: '2099-11-30', user: 'pricing-lock-test' })
    await upsertMonthlyProducerPricingRows([row])
    for (const status of ['SENT', 'SENDING', 'UNCONFIRMED']) {
      await pool.request().input('producer', sql.NVarChar(80), producer).input('status', sql.VarChar(20), status)
        .query("UPDATE dbo.MonthlyInvoices SET status=@status, erpId='test-only' WHERE producerCode=@producer")
      await assert.rejects(upsertMonthlyProducerPricingRows([{ ...row, responsiblePrice: 9, receiverCommission: 99, electricity: 99, responsibleComment: 'changed' }]), { code: 'INVOICE_PRICING_LOCKED' })
    }
    const saved = (await query('SELECT responsiblePrice,receiverCommission,electricity FROM dbo.MonthlyProducerPricing WHERE producerCode=@producer')).recordset[0]
    assert.deepEqual(saved, { responsiblePrice: 1.5, receiverCommission: 10, electricity: 20 })
    await assert.rejects(upsertMonthlyProducerPricingRows([{ ...row, producerCode: other }, row]), { code: 'INVOICE_PRICING_LOCKED' })
    assert.equal((await query('SELECT * FROM dbo.MonthlyProducerPricing WHERE producerCode=@other')).recordset.length, 0)
    await upsertMonthlyProducerPricingRows([{ ...row, milkType: 'MILK-SHEEP' }])
    await upsertMonthlyProducerPricingRows([{ ...row, monthKey: '2099-10' }])
    await query("UPDATE dbo.MonthlyInvoices SET milkType='' WHERE producerCode=@producer")
    await assert.rejects(upsertMonthlyProducerPricingRows([{ ...row, milkType: 'MILK-SHEEP' }]), { code: 'INVOICE_PRICING_LOCKED' })
    await query("UPDATE dbo.MonthlyInvoices SET status='DRAFT',erpId=NULL WHERE producerCode=@producer")
    await upsertMonthlyProducerPricingRows([{ ...row, responsiblePrice: 2 }])
    assert.equal((await query("SELECT responsiblePrice FROM dbo.MonthlyProducerPricing WHERE producerCode=@producer AND monthKey='2099-11' AND milkType='MILK-COW'")).recordset[0].responsiblePrice, 2)
  } finally {
    await query('DELETE FROM dbo.MonthlyProducerPricing WHERE producerCode IN (@producer,@other); DELETE FROM dbo.MonthlyInvoices WHERE producerCode IN (@producer,@other);')
    await closeSqlOcrStore()
    await closeMilkReceptionStore()
  }
})
