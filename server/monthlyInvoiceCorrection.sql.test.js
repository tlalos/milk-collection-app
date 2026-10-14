import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

test('paired SQL correction moves the sent invoice, persists both journal matches, preserves history and protects evidence', { skip: process.env.INVOICE_SQL_TEST !== '1' }, async t => {
  await import('dotenv/config')
  assert.match(process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost', /^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/i)
  const { default: sql } = await import('mssql')
  const { getMilkReceptionPool, closeMilkReceptionStore } = await import('./milkReceptionStore.js')
  const { saveSqlJob, getSqlJob, deleteSqlJob, closeSqlOcrStore } = await import('./sqlOcrStore.js')
  const { saveMonthlyInvoiceDate, claimMonthlyInvoice, finishMonthlyInvoiceAttempt, getMonthlyInvoiceHistory } = await import('./monthlyInvoiceStore.js')
  const { monthlyInvoiceCorrection } = await import('./monthlyInvoiceCorrection.js')
  const pool = await getMilkReceptionPool()
  const id = randomUUID(), month = '2098-09', invoiceIds = []
  let codes = []
  const user = { isAdmin: true, username: 'paired-correction-test' }
  try {
    const snapshot = (await pool.request().query("SELECT centersJson,producersJson FROM dbo.OcrErpReferenceSnapshot WHERE snapshotKey='suppliers'")).recordset[0]
    if (!snapshot) return t.skip('No local ERP reference snapshot')
    const refs = { centers: JSON.parse(snapshot.centersJson), producers: JSON.parse(snapshot.producersJson) }
    const center = refs.centers.find(c => refs.producers.filter(p => p.centerCode?.toLowerCase() === c.code?.toLowerCase()).length >= 2)
    if (!center) return t.skip('No center with two producers in the local reference snapshot')
    const pair = refs.producers.filter(p => p.centerCode?.toLowerCase() === center.code?.toLowerCase()).slice(0, 2)
    codes = pair.map(p => p.producerCode.toLowerCase())
    const existing = await pool.request().input('month',sql.Char(7),month).input('p1',sql.NVarChar(80),codes[0]).input('p2',sql.NVarChar(80),codes[1])
      .query('SELECT invoiceId FROM dbo.MonthlyInvoices WHERE monthKey=@month AND producerCode IN (@p1,@p2); SELECT pricingId FROM dbo.MonthlyProducerPricing WHERE monthKey=@month AND producerCode IN (@p1,@p2);')
    if (existing.recordsets.some(rows => rows.length)) { codes=[]; return t.skip('Test month already has records; do not modify them') }
    const job = { id, sourceFile:'paired-correction-test.jpg', storedFilename:null, documentCategory:'journal_monthly_settlement', status:'completed', reviewStatus:'reviewed', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
      data:{date:`${month}-30`,milkType:'MILK-COW',headerCenterName:center.name,totalLiters:300,rows:[{rowNumber:1,producer:pair[0].producerName,liters:100,milkType:'MILK-COW'},{rowNumber:2,producer:'Test unmatched row',liters:200,milkType:'MILK-COW'}]},
      producerMatches:[{rowNumber:1,selectedCode:codes[0],selectedName:pair[0].producerName,status:'confirmed'}] }
    await saveSqlJob(job)
    const invoice = await saveMonthlyInvoiceDate({month,producerCode:codes[0],milkType:'MILK-COW',invoiceDate:`${month}-30`,user:user.username})
    invoiceIds.push(invoice.invoiceId)
    const draft = await saveMonthlyInvoiceDate({month,producerCode:codes[1],milkType:'MILK-COW',invoiceDate:`${month}-30`,user:user.username})
    invoiceIds.push(draft.invoiceId)
    const attempt = await claimMonthlyInvoice({invoiceId:invoice.invoiceId,invoiceDate:`${month}-30`,series:5105,lines:[{testOnly:true,producerCode:codes[0],liters:100}],payload:[{testOnly:true}],user:user.username})
    await finishMonthlyInvoiceAttempt({attemptId:attempt.attemptId,erpId:`TEST-${randomUUID()}`})
    const altered = structuredClone(job); altered.data.rows[0].liters=999
    await assert.rejects(saveSqlJob(altered), /submitted invoice/)
    await assert.rejects(deleteSqlJob(id), /submitted invoice/)
    assert.equal((await getSqlJob(id)).data.rows[0].liters,100)
    const buildRows = jobs => {
      const j=jobs.find(j=>j.id===id)
      return j.data.rows.map(row=>({month,producer:row.producer,producerCode:j.producerMatches.find(m=>m.rowNumber===row.rowNumber)?.selectedCode||'',milkType:'MILK-COW',liters:row.liters,readyForPricing:true,center:center.name,journalRows:[{jobId:id,rowNumber:row.rowNumber}]}))
    }
    const args={invoiceId:invoice.invoiceId,user,buildRows}
    const context=await monthlyInvoiceCorrection(args)
    const input={version:context.version,producerCode:codes[1],matches:[{jobId:id,rowNumber:1,producerCode:codes[1]},{jobId:id,rowNumber:2,producerCode:codes[0]}],price:1.5,commission:10,electricity:5,reason:'Paired correction integration test',confirmed:true}
    const preview=await monthlyInvoiceCorrection({...args,input})
    // A rejected confirmation must leave both journal and invoice records unchanged.
    await assert.rejects(monthlyInvoiceCorrection({...args,input:{...input,previewToken:'stale'},apply:true}),/Review/)
    assert.equal((await getSqlJob(id)).data.rows[0].producer,pair[0].producerName)
    await monthlyInvoiceCorrection({...args,input:{...input,previewToken:preview.previewToken},apply:true})
    const saved=await getSqlJob(id)
    assert.deepEqual(saved.data.rows.map(row=>row.liters),[100,200])
    assert.deepEqual(saved.data.rows.map(row=>row.producer),[pair[1].producerName,pair[0].producerName])
    const history=await getMonthlyInvoiceHistory(invoice.invoiceId)
    assert.equal(history.invoice.producerCode,codes[1]); assert.equal(history.invoice.status,'SENT')
    assert.equal(history.corrections[0].before.invoice.producerCode,codes[0])
    assert.equal(history.corrections[0].before.replacedDrafts[0].invoiceId,draft.invoiceId)
    assert.equal(history.attempts.length,1)
    const original=(await pool.request().input('id',sql.UniqueIdentifier,invoice.invoiceId).query('SELECT snapshotJson FROM dbo.MonthlyInvoiceLines WHERE invoiceId=@id')).recordset[0]
    assert.equal(JSON.parse(original.snapshotJson).producerCode,codes[0])
    await assert.rejects(saveSqlJob(job),/submitted invoice/)
    await assert.rejects(claimMonthlyInvoice({invoiceId:invoice.invoiceId,invoiceDate:`${month}-30`,series:5105,lines:[{}],payload:[{}],user:user.username}),/already submitted/)
  } finally {
    for(const invoiceId of invoiceIds) await pool.request().input('id',sql.UniqueIdentifier,invoiceId).query(`
      IF OBJECT_ID(N'dbo.MonthlyInvoiceCorrections',N'U') IS NOT NULL DELETE dbo.MonthlyInvoiceCorrections WHERE invoiceId=@id;
      DELETE dbo.MonthlyInvoiceAttempts WHERE invoiceId=@id; DELETE dbo.MonthlyInvoiceLines WHERE invoiceId=@id; DELETE dbo.MonthlyInvoices WHERE invoiceId=@id;`)
    for(const producer of codes) await pool.request().input('p',sql.NVarChar(80),producer).input('month',sql.Char(7),month).query('DELETE dbo.MonthlyProducerPricing WHERE producerCode=@p AND monthKey=@month;')
    await pool.request().input('id',sql.NVarChar(64),id).query('DELETE dbo.OcrJobRows WHERE jobId=@id; DELETE dbo.OcrJobs WHERE id=@id;')
    await closeSqlOcrStore();await closeMilkReceptionStore()
  }
})
