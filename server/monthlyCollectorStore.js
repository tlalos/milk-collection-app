import sql from 'mssql'
import { getMilkReceptionPool } from './milkReceptionStore.js'
import { initializeMonthlyInvoices } from './monthlyInvoiceStore.js'
import { initializeMonthlyAvizPricingApprovals } from './monthlyAvizPricingApprovalStore.js'

const code = value => String(value || '').trim().toLowerCase()
export const isCollectorName = value => /\bcol{1,2}ector\b/iu.test(String(value || ''))
const conflict = message => Object.assign(new Error(message), { status: 409 })
let initialization
export async function initializeMonthlyCollectors() {
  initialization ??= (async () => {
    await (await getMilkReceptionPool()).request().batch(`
IF OBJECT_ID(N'dbo.MonthlyCollectors',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.MonthlyCollectors(
  monthKey CHAR(7) NOT NULL,
  producerCode NVARCHAR(80) NOT NULL,
  producerName NVARCHAR(240) NOT NULL,
  centerName NVARCHAR(240) NOT NULL,
  createdBy NVARCHAR(120) NOT NULL,
  createdAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT PK_MonthlyCollectors PRIMARY KEY(monthKey,producerCode),
  CONSTRAINT CK_MonthlyCollectors_Month CHECK(TRY_CONVERT(DATE,monthKey+'-01',23) IS NOT NULL)
 );
END;`)
  })().catch(error => { initialization = undefined; throw error })
  await initialization
}

export function collectorReference(producers, producerCode) {
  const matches = producers.filter(p => code(p.producerCode) === code(producerCode))
  if (matches.length !== 1 || !/^p\S+$/i.test(code(producerCode)) || !isCollectorName(matches[0].producerName)) throw conflict('Choose an ERP producer with colector or collector in their name.')
  if (!String(matches[0].centerName || '').trim()) throw conflict('The ERP collector needs a collection center.')
  return matches[0]
}

export async function changeMonthlyCollector({ month, producerCode, user, remove = false, buildRows }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw conflict('Select a valid collection month.')
  if (!user?.username) throw conflict('An authenticated user is required.')
  if (!/^p\S{1,79}$/i.test(String(producerCode || ''))) throw conflict('Choose a valid ERP producer code.')
  await initializeMonthlyCollectors()
  await initializeMonthlyInvoices()
  await initializeMonthlyAvizPricingApprovals()
  const tx = new sql.Transaction(await getMilkReceptionPool())
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  try {
    const request = new sql.Request(tx).input('month',sql.Char(7),month).input('producer',sql.NVarChar(80),code(producerCode))
    const records = await request.query(`
SELECT * FROM dbo.MonthlyCollectors WITH (UPDLOCK,HOLDLOCK) WHERE monthKey=@month AND producerCode=@producer;
SELECT jobJson FROM dbo.OcrJobs WITH (HOLDLOCK);
SELECT producersJson FROM dbo.OcrErpReferenceSnapshot WITH (HOLDLOCK) WHERE snapshotKey='suppliers';
SELECT * FROM dbo.MonthlyAvizPricingApprovals WITH (HOLDLOCK) WHERE monthKey=@month AND producerCode=@producer AND status<>'CANCELLED';
SELECT status FROM dbo.MonthlyInvoices WITH (UPDLOCK,HOLDLOCK) WHERE monthKey=@month AND producerCode=@producer;`)
    const [saved, jobs, refs, approvals, invoices] = records.recordsets
    if (invoices.some(invoice => invoice.status !== 'DRAFT')) throw conflict('This producer has a submitted invoice. Refresh the ERP status before changing the collector row.')
    let producer
    if (remove) {
      if (!saved.length) throw conflict('This collector row is no longer present.')
      producer = saved[0]
      await request.query('DELETE dbo.MonthlyCollectors WHERE monthKey=@month AND producerCode=@producer')
    } else {
      producer = collectorReference(refs[0] ? JSON.parse(refs[0].producersJson) : [], producerCode)
      if (saved.length) throw conflict('This collector is already in the selected month.')
      if (approvals.length || buildRows(jobs.map(j=>JSON.parse(j.jobJson)),month).some(row => code(row.producerCode) === code(producerCode))) throw conflict('This producer already has journal or approved aviz quantities for the month.')
      await request.input('name',sql.NVarChar(240),producer.producerName).input('center',sql.NVarChar(240),producer.centerName)
        .input('user',sql.NVarChar(120),user.username).query('INSERT dbo.MonthlyCollectors(monthKey,producerCode,producerName,centerName,createdBy) VALUES(@month,@producer,@name,@center,@user)')
    }
    await new sql.Request(tx).input('user',sql.NVarChar(160),user.username).input('action',sql.NVarChar(160),remove?'month_closure.collector.remove':'month_closure.collector.add')
      .input('id',sql.NVarChar(240),`${month}:${code(producerCode)}`).input('json',sql.NVarChar(sql.MAX),JSON.stringify({month,producerCode:code(producerCode),producerName:producer.producerName,centerName:producer.centerName,actualLiters:0,invoiceQuantity:1}))
      .query("INSERT dbo.AppAuditLog(occurredAt,username,action,entityType,entityId,afterJson) VALUES(SYSDATETIMEOFFSET(),@user,@action,'MonthlyCollectors',@id,@json)")
    await tx.commit()
    return { month, producerCode: code(producerCode) }
  } catch(error) { await tx.rollback().catch(()=>{}); throw error }
}

export function collectorPricingRows(collectors, references) {
  return collectors.map(saved => {
    let producer, warning
    try { producer = collectorReference(references?.producers || [], saved.producerCode) }
    catch(error) { warning = error.message }
    return { month:saved.monthKey, producerCode:saved.producerCode, producer:producer?.producerName || saved.producerName,
      center:producer?.centerName || saved.centerName, milkType:'MILK-COW', source:'collector', liters:0, invoiceQuantity:1,
      producerWarning:warning || null, sourceRowCount:0, journalRows:[], reconciliationStatus:'ok', reconciliationDifferenceLiters:0,
      centerAvizLiters:0, centerMonthlyLiters:0, centerJournalRows:0, centerAvizLines:0 }
  })
}
