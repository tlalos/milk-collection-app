import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

test('local collector persistence prevents duplicates and removal after submitting', {skip:process.env.INVOICE_SQL_TEST !== '1'}, async t => {
  await import('dotenv/config')
  assert.match(process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost', /^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/i)
  const {default:sql}=await import('mssql')
  const {getMilkReceptionPool,closeMilkReceptionStore}=await import('./milkReceptionStore.js')
  const {initializeMonthlyCollectors,changeMonthlyCollector,isCollectorName}=await import('./monthlyCollectorStore.js')
  const {initializeMonthlyInvoices,saveMonthlyInvoiceDate,claimMonthlyInvoice,finishMonthlyInvoiceAttempt}=await import('./monthlyInvoiceStore.js')
  const pool=await getMilkReceptionPool(), month='2097-12', user={username:`collector-test-${randomUUID()}`}
  let producerCode, invoiceId, ownsRecords=false
  try {
    await initializeMonthlyCollectors(); await initializeMonthlyInvoices()
    const snapshot=(await pool.request().query("SELECT producersJson FROM dbo.OcrErpReferenceSnapshot WHERE snapshotKey='suppliers'")).recordset[0]
    const producer=snapshot && JSON.parse(snapshot.producersJson).find(p=>isCollectorName(p.producerName) && p.centerName)
    if(!producer) return t.skip('No collector in local ERP reference cache')
    producerCode=producer.producerCode.toLowerCase()
    const existing=await pool.request().input('m',sql.Char(7),month).input('p',sql.NVarChar(80),producerCode).query('SELECT * FROM dbo.MonthlyCollectors WHERE monthKey=@m AND producerCode=@p; SELECT invoiceId FROM dbo.MonthlyInvoices WHERE monthKey=@m AND producerCode=@p;')
    if(existing.recordsets.some(rows=>rows.length)) return t.skip('Test month already has records')
    ownsRecords=true
    const args={month,producerCode,user,buildRows:()=>[]}
    await assert.rejects(changeMonthlyCollector({...args,buildRows:()=>[{producerCode}]}),/journal or approved/)
    await assert.rejects(changeMonthlyCollector({...args,month:'2026-13'}),/valid collection month/)
    const concurrent=await Promise.allSettled([changeMonthlyCollector(args),changeMonthlyCollector(args)])
    assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1)
    await assert.rejects(changeMonthlyCollector(args),/already in/)
    const saved=(await pool.request().input('m',sql.Char(7),month).input('p',sql.NVarChar(80),producerCode).query('SELECT * FROM dbo.MonthlyCollectors WHERE monthKey=@m AND producerCode=@p')).recordset
    assert.equal(saved.length,1); assert.equal(saved[0].createdBy,user.username)
    await changeMonthlyCollector({...args,remove:true})
    await changeMonthlyCollector(args)
    const invoice=await saveMonthlyInvoiceDate({month,producerCode,milkType:'MILK-COW',invoiceDate:`${month}-31`,user:user.username})
    invoiceId=invoice.invoiceId
    const attempt=await claimMonthlyInvoice({invoiceId,invoiceDate:`${month}-31`,series:5106,lines:[{testOnly:true,liters:0,invoiceQuantity:1}],payload:[{testOnly:true}],user:user.username})
    await assert.rejects(changeMonthlyCollector({...args,remove:true}),/submitted invoice/)
    await finishMonthlyInvoiceAttempt({attemptId:attempt.attemptId,erpId:`TEST-${randomUUID()}`})
    await assert.rejects(changeMonthlyCollector({...args,remove:true}),/submitted invoice/)
    await assert.rejects(changeMonthlyCollector(args),/submitted invoice/)
  } finally {
    if(invoiceId) await pool.request().input('id',sql.UniqueIdentifier,invoiceId).query('DELETE dbo.MonthlyInvoiceAttempts WHERE invoiceId=@id; DELETE dbo.MonthlyInvoiceLines WHERE invoiceId=@id; DELETE dbo.MonthlyInvoices WHERE invoiceId=@id;')
    if(ownsRecords) await pool.request().input('m',sql.Char(7),month).input('p',sql.NVarChar(80),producerCode).input('u',sql.NVarChar(160),user.username).query("DELETE dbo.MonthlyCollectors WHERE monthKey=@m AND producerCode=@p AND createdBy=@u; DELETE dbo.AppAuditLog WHERE username=@u AND entityType='MonthlyCollectors';")
    await closeMilkReceptionStore()
  }
})
