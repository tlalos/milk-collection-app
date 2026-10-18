import sql from 'mssql'
import { z } from 'zod'

export const normalizeCmrTruck = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/gu, '')
export function cmrReconciliationDocuments(jobs, links, receptions, month) {
  const receptionIds = new Set(receptions.map(row => row.receptionId))
  const linkedIds = new Set(links.filter(link => receptionIds.has(link.receptionId)).map(link => link.jobId))
  return jobs.filter(job => job.documentCategory === 'cmr'
    && (String(job.data?.date || job.createdAt || '').startsWith(month) || linkedIds.has(job.id)))
    .map(job => ({ id: job.id, sourceFile: job.sourceFile, documentDate: job.data?.date || null, createdAt: job.createdAt,
      vehicleRegistration: job.data?.truckNumber || '', supplier: job.data?.supplier || '', driver: job.data?.driver || '',
      avizNumber: job.data?.avizNumber || '', quantity: job.data?.quantity === undefined ? job.data?.kilos ?? null : job.data.quantity,
      quantityUnit: job.data?.quantityUnit ?? 'kg', jobStatus: job.status, reviewStatus: job.reviewStatus }))
}
const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10)
const version = value => value ? `0x${Buffer.from(value).toString('hex')}` : null
const fail = (message, status = 409) => Object.assign(new Error(message), { status })
export function isCmrReceptionCandidate(document, reception) {
  const truck = normalizeCmrTruck(document.truckNumber)
  return Boolean(day(document.documentDate) && truck && reception.vehicleCategory === 'OTHER'
    && day(document.documentDate) === day(reception.receptionDate)
    && truck === normalizeCmrTruck(reception.vehicleRegistration))
}
const receptionFields = 'receptionId,receptionDate,vehicleRegistration,vehicleCategory,driverName,milkType,netQuantityKg,calculatedLiters,updatedAt'
const publicReception = row => row && ({ ...row, receptionDate: day(row.receptionDate), updatedAt: row.updatedAt.toISOString() })
const publicLink = row => row ? { receptionId: row.receptionId, status: row.status, version: version(row.rowVersion), linkedBy: row.linkedBy } : null
const linkInput = z.object({
  receptionId: z.string().min(1).max(120).nullable(),
  documentVersion: z.string().regex(/^0x[0-9a-f]{16}$/i),
  updatedAt: z.string().min(1),
  linkVersion: z.string().regex(/^0x[0-9a-f]{16}$/i).nullable(),
  receptionUpdatedAt: z.string().datetime().optional(),
}).strict()

export async function readCmrReceptionMatch(pool, jobId) {
  const request = pool.request().input('id', sql.NVarChar(64), jobId)
  const result = await request.query(`
    SELECT c.*,j.jobJson FROM dbo.CmrDocuments c JOIN dbo.OcrJobs j ON j.id=c.jobId WHERE c.jobId=@id;
    SELECT * FROM dbo.CmrReceptionLinks WHERE jobId=@id;
    SELECT ${receptionFields} FROM dbo.MilkReceptions WHERE receptionId IN (SELECT receptionId FROM dbo.CmrReceptionLinks WHERE jobId=@id)
      OR (vehicleCategory=N'OTHER' AND receptionDate=(SELECT documentDate FROM dbo.CmrDocuments WHERE jobId=@id));`)
  const document = result.recordsets[0][0]
  if (!document) throw fail('CMR document not found.', 404)
  const link = result.recordsets[1][0]
  const receptions = result.recordsets[2]
  return { documentVersion: version(document.rowVersion), updatedAt: JSON.parse(document.jobJson).updatedAt,
    link: publicLink(link), linkedReception: publicReception(receptions.find(row => row.receptionId === link?.receptionId)) || null,
    candidates: receptions.filter(row => isCmrReceptionCandidate(document, row)).map(publicReception)
      .sort((a, b) => a.receptionId.localeCompare(b.receptionId)) }
}

export async function writeCmrReceptionMatch(pool, jobId, input, user = {}) {
  const parsed = linkInput.safeParse(input)
  if (!parsed.success || (parsed.data.receptionId && !parsed.data.receptionUpdatedAt)) throw fail('Reload the reception candidates before confirming.', 400)
  const edit = parsed.data
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    // Lock the job first, matching the CMR save order, then validate the live reception.
    const request = () => new sql.Request(tx).input('id', sql.NVarChar(64), jobId)
    const job = (await request().query('SELECT jobJson FROM dbo.OcrJobs WITH (UPDLOCK,HOLDLOCK) WHERE id=@id;')).recordset[0]
    const document = (await request().query('SELECT * FROM dbo.CmrDocuments WITH (UPDLOCK,HOLDLOCK) WHERE jobId=@id;')).recordset[0]
    if (!document || !job) throw fail('CMR document not found.', 404)
    if (['queued', 'processing'].includes(JSON.parse(job.jobJson).status)) throw fail('Wait for CMR recognition to finish before matching.')
    if (version(document.rowVersion) !== edit.documentVersion.toLowerCase() || JSON.parse(job.jobJson).updatedAt !== edit.updatedAt) throw fail('The CMR changed. Reload the document before matching.')
    let reception
    if (edit.receptionId) {
      reception = (await new sql.Request(tx).input('reception', sql.NVarChar(120), edit.receptionId)
        .query(`SELECT ${receptionFields} FROM dbo.MilkReceptions WITH (UPDLOCK,HOLDLOCK) WHERE receptionId=@reception;`)).recordset[0]
      if (!reception || !isCmrReceptionCandidate(document, reception)) throw fail('Choose an Others reception with the same date and truck as the CMR.')
      if (reception.updatedAt.toISOString() !== edit.receptionUpdatedAt) throw fail('The reception changed. Refresh the candidates before confirming.')
    }
    const before = (await request().query('SELECT * FROM dbo.CmrReceptionLinks WITH (UPDLOCK,HOLDLOCK) WHERE jobId=@id;')).recordset[0]
    if (version(before?.rowVersion) !== (edit.linkVersion?.toLowerCase() ?? null)) throw fail('The reception link changed. Refresh before continuing.')
    await request().query('DELETE dbo.CmrReceptionLinks WHERE jobId=@id;')
    if (reception) await request().input('reception', sql.NVarChar(120), reception.receptionId)
      .input('date', sql.Date, document.documentDate).input('truck', sql.NVarChar(300), document.truckNumber)
      .input('user', sql.NVarChar(160), user.username || '')
      .query(`INSERT dbo.CmrReceptionLinks(jobId,receptionId,matchedDocumentDate,matchedReceptionDate,matchedTruckNumber,linkedBy)
        VALUES(@id,@reception,@date,@date,@truck,@user);`)
    const after = (await request().query('SELECT * FROM dbo.CmrReceptionLinks WHERE jobId=@id;')).recordset[0]
    await request().input('userId', sql.NVarChar(64), user.id || null).input('username', sql.NVarChar(160), user.username || '')
      .input('before', sql.NVarChar(sql.MAX), before ? JSON.stringify(publicLink(before)) : null)
      .input('after', sql.NVarChar(sql.MAX), after ? JSON.stringify(publicLink(after)) : null)
      .query(`INSERT dbo.AppAuditLog(occurredAt,userId,username,action,entityType,entityId,beforeJson,afterJson)
        VALUES(SYSDATETIMEOFFSET(),@userId,@username,N'cmr.reception.link',N'CmrDocument',@id,@before,@after);`)
    await tx.commit()
  } catch (error) { await tx.rollback().catch(() => undefined); throw error }
  return readCmrReceptionMatch(pool, jobId)
}
