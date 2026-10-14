import { createHash, randomUUID } from 'node:crypto'
import sql from 'mssql'
import { getMilkReceptionPool } from './milkReceptionStore.js'
import { initializeMonthlyInvoices } from './monthlyInvoiceStore.js'
import { initializeSqlOcrStore, saveSqlJob } from './sqlOcrStore.js'
import { initializeMonthlyAvizPricingApprovals } from './monthlyAvizPricingApprovalStore.js'
import { matchingMonthlyProducer, monthlyProducerWarning } from './monthlyProducerValidation.js'
import { initializeMonthlyCollectors } from './monthlyCollectorStore.js'

const code = value => String(value || '').trim().toLowerCase()
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const conflict = message => Object.assign(new Error(message), { status: 409 })

export function requireInvoiceCorrectionAdmin(request, response, next) {
  if (request.authUser?.isAdmin !== true) return response.status(403).json({ error: 'Only administrators can correct sent invoices.' })
  next()
}

export function validateCorrectionInput(input, user) {
  if (user?.isAdmin !== true || !user.username) throw Object.assign(new Error('Only administrators can correct sent invoices.'), { status: 403 })
  if (input.confirmed !== true) throw conflict('Confirm that the existing invoice was corrected in ERP and must not be sent again.')
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) throw conflict('A correction reason of up to 1000 characters is required.')
  if (!/^p\S+$/i.test(input.producerCode || '') || input.producerCode.length > 80) throw conflict('Choose an ERP producer.')
  for (const key of ['price', 'commission', 'electricity']) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < 0 || input[key] >= 1e14 || Math.abs(input[key] * 10000 - Math.round(input[key] * 10000)) > 0.01) {
      throw conflict('Enter nonnegative pricing amounts with at most four decimal places.')
    }
  }
  if (!Array.isArray(input.matches) || input.matches.length > 500) throw conflict('Invalid journal corrections.')
}

export function prepareCorrection(context, input, buildRows) {
  const { invoice, invoices, jobs, references, pricing, approvals, collectors = [] } = context
  if (invoice.status !== 'SENT' || !invoice.erpId || !invoice.milkType) throw conflict('Only a sent, individual invoice with an ERP ID can be corrected.')
  if (input.version !== context.version) throw conflict('The documents or pricing changed. Close and reopen the correction.')
  const originalRows = buildRows(jobs, invoice.monthKey, pricing, approvals, references, collectors)
  const original = originalRows.find(row => code(row.producerCode) === code(invoice.producerCode) && row.milkType === invoice.milkType)
  const allowedJobs = new Set(original?.journalRows?.map(row => row.jobId) || [])
  const changedJobs = new Map()
  const seen = new Set()
  const affectedCodes = new Set([code(invoice.producerCode), code(input.producerCode)])
  for (const edit of input.matches) {
    const key = `${edit.jobId}:${edit.rowNumber}`
    if (seen.has(key) || !allowedJobs.has(edit.jobId) || !Number.isInteger(edit.rowNumber)) throw conflict('Invalid or duplicate journal row correction.')
    seen.add(key)
    const source = jobs.find(job => job.id === edit.jobId)
    const job = changedJobs.get(edit.jobId) || structuredClone(source)
    const row = job?.data?.rows?.find(row => row.rowNumber === edit.rowNumber)
    if (!row || (row.milkType || job.data.milkType) !== invoice.milkType) throw conflict('Choose a row with the invoice milk type.')
    const producers = references?.producers?.filter(p => code(p.producerCode) === code(edit.producerCode)) || []
    if (producers.length !== 1) throw conflict('Expected one exact ERP producer match.')
    const producer = producers[0]
    const warning = monthlyProducerWarning({ producer: producer.producerName, producerCode: producer.producerCode, centerName: job.data.headerCenterName }, references)
    if (warning) throw conflict(`${producer.producerName}: ${warning}`)
    const oldMatch = job.producerMatches?.find(match => match.rowNumber === row.rowNumber)
    affectedCodes.add(code(matchingMonthlyProducer(row, oldMatch)?.selectedCode))
    affectedCodes.add(code(producer.producerCode))
    row.producer = producer.producerName
    // Some older monthly documents use centerName as the producer text.
    row.centerName = producer.producerName
    const suggestion = { code: producer.producerCode, name: producer.producerName, centerCode: producer.centerCode, centerName: producer.centerName, score: 1 }
    const match = { ...oldMatch, rowNumber: row.rowNumber, originalName: oldMatch?.originalName || source.data.rows.find(r => r.rowNumber === row.rowNumber)?.producer,
      selectedCode: producer.producerCode, selectedName: producer.producerName, status: 'confirmed', suggestions: [suggestion] }
    job.producerMatches = [...(job.producerMatches || []).filter(m => m.rowNumber !== row.rowNumber), match]
    changedJobs.set(job.id, job)
  }
  if (invoices.some(other => other.invoiceId !== invoice.invoiceId && affectedCodes.has(code(other.producerCode)) && (!other.milkType || other.milkType === invoice.milkType) && other.status !== 'DRAFT')) {
    throw conflict('Another affected producer has a submitted invoice. Resolve that invoice separately before correcting these rows.')
  }
  const nextJobs = jobs.map(job => changedJobs.get(job.id) || job)
  const rows = buildRows(nextJobs, invoice.monthKey, pricing, approvals, references, collectors)
  const target = rows.find(row => code(row.producerCode) === code(input.producerCode) && row.milkType === invoice.milkType)
  if (!target || target.producerWarning || target.duplicateProducer || target.missingLiters || target.approvalReviewRequired || !target.readyForPricing || (target.source === 'collector' ? target.liters !== 0 || input.commission + input.electricity <= 0 : !(target.liters > 0))) {
    throw conflict('The corrected producer needs a valid, reconciled journal or approved aviz row without duplicates.')
  }
  if ((original?.source === 'collector' || target.source === 'collector') && code(input.producerCode) !== code(invoice.producerCode)) throw conflict('Collector corrections can change amounts, but cannot move the invoice to another producer.')
  const drafts = invoices.filter(other => other.invoiceId !== invoice.invoiceId && code(other.producerCode) === code(input.producerCode) && (!other.milkType || other.milkType === invoice.milkType))
  if (drafts.some(draft => draft.status !== 'DRAFT' || draft.attemptCount || draft.lineCount || draft.correctionCount || draft.erpId || !draft.milkType)) throw conflict('The target producer already has invoice history. It cannot be replaced.')
  const affectedRows = rows.filter(row => affectedCodes.has(code(row.producerCode)) && row.milkType === invoice.milkType)
  if (affectedRows.some(row => row.producerWarning || row.duplicateProducer || row.approvalReviewRequired)) throw conflict('An affected producer has a matching or duplicate warning. Correct the related rows together.')
  const preview = { month: invoice.monthKey, erpId: invoice.erpId, erpNumber: invoice.erpNumber,
    previousProducerCode: invoice.producerCode, producerCode: target.producerCode, producer: target.producer, milkType: invoice.milkType,
    liters: target.liters, price: input.price, commission: input.commission, electricity: input.electricity,
    subtotal: Math.round((target.liters * input.price + input.commission + input.electricity) * 100) / 100,
    changedJournalRows: input.matches.length, affectedRows: affectedRows.map(row => ({ producer: row.producer, producerCode: row.producerCode, liters: row.liters, price: row.price, commission: row.commission, electricity: row.electricity })) }
  return { preview, token: hash({ version: context.version, input: { ...input, previewToken: undefined }, preview }), changedJobs: [...changedJobs.values()], target, drafts }
}

let initialization
async function initialize() {
  await initializeSqlOcrStore()
  await initializeMonthlyInvoices()
  await initializeMonthlyAvizPricingApprovals()
  await initializeMonthlyCollectors()
  initialization ??= (async () => {
    await (await getMilkReceptionPool()).request().batch(`
IF OBJECT_ID(N'dbo.MonthlyInvoiceCorrections', N'U') IS NULL
BEGIN
 CREATE TABLE dbo.MonthlyInvoiceCorrections (
  correctionId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  invoiceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.MonthlyInvoices(invoiceId),
  reason NVARCHAR(1000) NOT NULL, correctedBy NVARCHAR(120) NOT NULL,
  correctedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  beforeJson NVARCHAR(MAX) NOT NULL CHECK(ISJSON(beforeJson)=1),
  afterJson NVARCHAR(MAX) NOT NULL CHECK(ISJSON(afterJson)=1)
 );
END;`)
  })().catch(error => { initialization = undefined; throw error })
  await initialization
}

// The preview is read-only. Applying locks evidence, pricing and invoice records together.
export async function monthlyInvoiceCorrection({ invoiceId, user, input, apply = false, buildRows }) {
  if (user?.isAdmin !== true || !user.username) throw Object.assign(new Error('Only administrators can correct sent invoices.'), { status: 403 })
  if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(invoiceId || '')) throw conflict('Invalid invoice ID.')
  if (input) validateCorrectionInput(input, user)
  await initialize()
  const tx = new sql.Transaction(await getMilkReceptionPool())
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  try {
    const invoice = (await new sql.Request(tx).input('id', sql.UniqueIdentifier, invoiceId).query('SELECT * FROM dbo.MonthlyInvoices WITH (UPDLOCK,HOLDLOCK) WHERE invoiceId=@id')).recordset[0]
    if (!invoice || invoice.status !== 'SENT' || !invoice.erpId || !invoice.milkType) throw conflict('Only sent individual invoices can be corrected.')
    const records = await new sql.Request(tx).input('month', sql.Char(7), invoice.monthKey).query(`
SELECT jobJson FROM dbo.OcrJobs WITH (UPDLOCK,HOLDLOCK) ORDER BY id;
SELECT centersJson,producersJson FROM dbo.OcrErpReferenceSnapshot WITH (HOLDLOCK) WHERE snapshotKey='suppliers';
SELECT * FROM dbo.MonthlyProducerPricing WITH (UPDLOCK,HOLDLOCK) WHERE monthKey=@month ORDER BY pricingId;
SELECT i.*, (SELECT COUNT(*) FROM dbo.MonthlyInvoiceAttempts a WHERE a.invoiceId=i.invoiceId) AS attemptCount,
 (SELECT COUNT(*) FROM dbo.MonthlyInvoiceLines l WHERE l.invoiceId=i.invoiceId) AS lineCount,
 (SELECT COUNT(*) FROM dbo.MonthlyInvoiceCorrections c WHERE c.invoiceId=i.invoiceId) AS correctionCount
FROM dbo.MonthlyInvoices i WITH (UPDLOCK,HOLDLOCK) WHERE monthKey=@month ORDER BY invoiceId;
SELECT * FROM dbo.MonthlyAvizPricingApprovals WITH (UPDLOCK,HOLDLOCK) WHERE monthKey=@month AND status<>'CANCELLED';
SELECT * FROM dbo.MonthlyCollectors WITH (UPDLOCK,HOLDLOCK) WHERE monthKey=@month ORDER BY producerCode;`)
    const [jobRecords, refs, pricing, invoices, approvals, collectors] = records.recordsets
    const jobs = jobRecords.map(row => JSON.parse(row.jobJson))
    const references = refs[0] ? { centers: JSON.parse(refs[0].centersJson), producers: JSON.parse(refs[0].producersJson) } : null
    const context = { invoice, jobs, references, pricing, invoices, approvals, collectors, version: hash(records.recordsets) }
    if (!input) {
      const rows = buildRows(jobs, invoice.monthKey, pricing, approvals, references, collectors)
      const current = rows.find(row => code(row.producerCode) === code(invoice.producerCode) && row.milkType === invoice.milkType)
      const sourceIds = new Set(current?.journalRows?.map(row => row.jobId) || [])
      const journals = jobs.filter(job => sourceIds.has(job.id)).map(job => ({ id: job.id, sourceFile: job.sourceFile, center: job.data.headerCenterName,
        rows: job.data.rows.filter(row => (row.milkType || job.data.milkType) === invoice.milkType).map(row => ({ rowNumber: row.rowNumber, producer: row.producer || row.centerName, liters: row.liters,
          producerCode: matchingMonthlyProducer(row, job.producerMatches?.find(m => m.rowNumber === row.rowNumber))?.selectedCode || '' })) }))
      await tx.commit()
      return { invoice, version: context.version, current, journals, producers: references?.producers || [], rows }
    }
    const prepared = prepareCorrection(context, input, buildRows)
    if (apply) {
      if (input.previewToken !== prepared.token) throw conflict('Review the current correction preview before finishing.')
      const { target, drafts, changedJobs, preview } = prepared
      const affected = new Set([code(invoice.producerCode), code(target.producerCode), ...preview.affectedRows.map(row => code(row.producerCode))])
      const before = { invoice, pricing: pricing.filter(row => affected.has(code(row.producerCode)) && row.milkType === invoice.milkType), journals: jobs.filter(job => changedJobs.some(changed => changed.id === job.id)), replacedDrafts: drafts }
      for (const job of changedJobs) {
        job.updatedAt = new Date().toISOString()
        await saveSqlJob(job, tx)
      }
      // Only unused date placeholders can be replaced; attempts and sent snapshots are immutable.
      for (const draft of drafts) await new sql.Request(tx).input('id', sql.UniqueIdentifier, draft.invoiceId).query('DELETE dbo.MonthlyInvoices WHERE invoiceId=@id AND status=\'DRAFT\'')
      await new sql.Request(tx).input('id', sql.UniqueIdentifier, invoiceId).input('producer', sql.NVarChar(80), code(target.producerCode))
        .query("UPDATE dbo.MonthlyInvoices SET producerCode=@producer,updatedAt=SYSDATETIMEOFFSET() WHERE invoiceId=@id AND status='SENT'")
      await new sql.Request(tx).input('month', sql.Char(7), invoice.monthKey).input('producer', sql.NVarChar(80), code(target.producerCode))
        .input('milk', sql.NVarChar(40), invoice.milkType).input('name', sql.NVarChar(240), target.producer).input('center', sql.NVarChar(240), target.center)
        .input('price', sql.Decimal(18,4), input.price).input('commission', sql.Decimal(18,4), input.commission).input('electricity', sql.Decimal(18,4), input.electricity).query(`
MERGE dbo.MonthlyProducerPricing AS t
USING (SELECT @month monthKey,@producer producerCode,@milk milkType) s
ON t.monthKey=s.monthKey AND t.producerCode=s.producerCode AND t.milkType=s.milkType
WHEN MATCHED THEN UPDATE SET producerName=@name,centerName=@center,responsiblePrice=@price,receiverCommission=@commission,electricity=@electricity,pricingStatus='SAVED',lastSaved=SYSDATETIMEOFFSET(),updatedAt=SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN INSERT(monthKey,producerCode,milkType,producerName,centerName,responsiblePrice,receiverCommission,electricity,pricingStatus,lastSaved)
VALUES(@month,@producer,@milk,@name,@center,@price,@commission,@electricity,'SAVED',SYSDATETIMEOFFSET());`)
      await new sql.Request(tx).input('id', sql.UniqueIdentifier, invoiceId).input('correction', sql.UniqueIdentifier, randomUUID())
        .input('reason', sql.NVarChar(1000), input.reason.trim()).input('user', sql.NVarChar(120), user.username)
        .input('before', sql.NVarChar(sql.MAX), JSON.stringify(before)).input('after', sql.NVarChar(sql.MAX), JSON.stringify({ ...preview, status: 'SENT', journals: changedJobs }))
        .query('INSERT dbo.MonthlyInvoiceCorrections(correctionId,invoiceId,reason,correctedBy,beforeJson,afterJson) VALUES(@correction,@id,@reason,@user,@before,@after)')
    }
    await tx.commit()
    return { preview: prepared.preview, previewToken: prepared.token, applied: apply, status: 'SENT' }
  } catch (error) { await tx.rollback().catch(() => {}); throw error }
}
