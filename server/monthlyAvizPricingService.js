import sql from 'mssql'
import { randomUUID } from 'node:crypto'
import { getMilkReceptionPool } from './milkReceptionStore.js'
import { buildMonthlyAvizApprovalSnapshot, initializeMonthlyAvizPricingApprovals } from './monthlyAvizPricingApprovalStore.js'

const code = value => String(value || '').trim().toLowerCase()
const name = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').trim().toUpperCase().replace(/\s+/gu, ' ')

export function centerMatchWarning(group, references) {
  if (!references) return 'Cannot verify the center: ERP reference list is unavailable.'
  for (const row of group.avizRows) {
    if (!code(row.centerCode)) return 'ERP center code is missing. Select the correct center on the aviz line.'
    const center = references.centers.find(center => code(center.code) === code(row.centerCode))
    if (!center) return `ERP center code ${row.centerCode} does not exist in the reference list.`
    if (name(row.centerName ?? group.center) !== name(center.name)) {
      return `Saved center name "${row.centerName ?? group.center}" does not match ERP center "${center.name}" (${center.code}). Correct the aviz center match.`
    }
  }
  return null
}

export function approvalCandidates(groups, references) {
  return groups.map(group => {
    const warning = centerMatchWarning(group, references)
    const savedCodes = [...new Set(group.avizRows.map(row => code(row.centerCode)))]
    const resolvedCenter = savedCodes.length === 1 && savedCodes[0] && references?.centers.find(center => code(center.code) === savedCodes[0])
    const linkedProducers = resolvedCenter
      ? [...new Map(references.producers.filter(producer => code(producer.centerCode) === savedCodes[0])
        .map(producer => [code(producer.producerCode), { producerCode: producer.producerCode, producerName: producer.producerName }])).values()]
        .sort((a, b) => String(a.producerName).localeCompare(String(b.producerName)))
      : null
    try {
      if (!references) throw new Error('ERP reference list is unavailable.')
      const selected = [...new Set(group.avizRows.map(row => code(row.centerCode)).filter(Boolean))]
      const centers = selected.length
        ? references.centers.filter(center => selected.includes(code(center.code)))
        : references.centers.filter(center => name(center.name) === name(group.center))
      if (selected.length > 1 || centers.length !== 1) throw new Error('A unique ERP center code is required.')
      const center = centers[0]
      if (group.avizRows.some(row => !row.centerCode || ('centerName' in row && name(row.centerName) !== name(center.name))) || name(group.center) !== name(center.name)) {
        throw new Error('Select the correct ERP center for every aviz line before approving pricing.')
      }
      // A center split across aliases must be reconciled before approving its quantity.
      if (groups.some(other => other.id !== group.id && other.month === group.month && other.milkType === group.milkType &&
        (name(other.center) === name(center.name) || other.avizRows.some(row => code(row.centerCode) === code(center.code))))) {
        throw new Error('This ERP center has multiple reconciliation groups. Resolve the center matching first.')
      }
      const snapshot = buildMonthlyAvizApprovalSnapshot({ monthKey: group.month, centerCode: center.code,
        milkType: group.milkType, producers: references.producers, lines: group.avizRows,
        hasJournal: group.monthlyRowCount > 0 })
      if (groups.some(other => other.month === group.month && other.milkType === group.milkType &&
        other.monthlyRows.some(row => code(row.producerCode) === snapshot.producerCode))) {
        throw new Error('This producer already has a journal for this month and milk type.')
      }
      const producer = references.producers.find(p => code(p.producerCode) === snapshot.producerCode)
      return { groupId: group.id, ...snapshot, centerName: center.name, producerName: producer.producerName, centerMatchWarning: warning, linkedProducers }
    } catch (error) { return { groupId: group.id, reason: error.message, centerMatchWarning: warning, linkedProducers } }
  })
}

export function approvalReviewReason(approval, candidates) {
  const current = candidates.find(c => c.monthKey === approval.monthKey && c.centerCode === code(approval.centerCode) && c.milkType === approval.milkType)
  if (!current) return 'Aviz, journal, or ERP relationship changed. Cancel this approval and review the current documents.'
  if (current.sourceFingerprint !== approval.sourceFingerprint) return 'Aviz quantities, source lines, or ERP producer changed.'
  return null
}

function conflict(message) { return Object.assign(new Error(message), { status: 409 }) }

// Read source documents and write approvals within one serialized transaction.
// No OCR foreign keys: approved evidence survives deletion of a source document.
export async function monthlyAvizApprovalContext(groupBuilder, action = null, user = null) {
  await initializeMonthlyAvizPricingApprovals()
  const pool = await getMilkReceptionPool()
  const tx = new sql.Transaction(pool)
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  try {
    const query = text => new sql.Request(tx).query(text)
    await query(`DECLARE @result INT; EXEC @result=sp_getapplock @Resource=N'MonthlyAvizPricingApprovals',
      @LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=15000;
      IF @result<0 THROW 51000,'Approval is busy. Try again.',1;`)
    const records = await query(`SELECT jobJson FROM dbo.OcrJobs; SELECT centersJson,producersJson FROM dbo.OcrErpReferenceSnapshot WHERE snapshotKey='suppliers';
      SELECT * FROM dbo.MonthlyAvizPricingApprovals WHERE status <> 'CANCELLED';`)
    const jobs = records.recordsets[0].map(row => JSON.parse(row.jobJson))
    const reference = records.recordsets[1][0]
    const references = reference ? { centers: JSON.parse(reference.centersJson), producers: JSON.parse(reference.producersJson) } : null
    const reconciliation = groupBuilder(jobs)
    const candidates = approvalCandidates(reconciliation.rows, references)
    const approvals = records.recordsets[2]
    const actor = String(user?.username || user?.id || 'system').slice(0,120)
    const audit = async (event, id, data) => {
      await new sql.Request(tx).input('actor',sql.NVarChar(160),actor).input('event',sql.NVarChar(160),event)
        .input('id',sql.NVarChar(240),id).input('data',sql.NVarChar(sql.MAX),JSON.stringify(data)).query(`
        INSERT dbo.AppAuditLog(occurredAt,username,action,entityType,entityId,afterJson)
        VALUES(SYSDATETIMEOFFSET(),@actor,@event,'MonthlyAvizPricingApprovals',@id,@data)`)
    }
    for (const approval of approvals) {
      const reason = approvalReviewReason(approval, candidates)
      if (reason && approval.status === 'APPROVED') {
        await new sql.Request(tx).input('id',sql.UniqueIdentifier,approval.approvalId).input('reason',sql.NVarChar(1000),reason)
          .query("UPDATE dbo.MonthlyAvizPricingApprovals SET status='NEEDS_REVIEW',reviewReason=@reason,reviewRequiredAt=SYSDATETIMEOFFSET() WHERE approvalId=@id")
        approval.status = 'NEEDS_REVIEW'
        approval.reviewReason = reason
        await audit('monthly_aviz_pricing.review_required',approval.approvalId,approval)
      }
    }
    let saved = null
    if (action?.type === 'approve') {
      const candidate = candidates.find(c => c.groupId === action.groupId)
      if (!candidate || candidate.reason) throw conflict(candidate?.reason || 'The reconciliation row no longer exists.')
      if (candidate.sourceFingerprint !== action.fingerprint) throw conflict('Data changed since the confirmation opened. Refresh and confirm again.')
      if (approvals.some(a => a.monthKey === candidate.monthKey && code(a.centerCode) === candidate.centerCode && a.milkType === candidate.milkType)) throw conflict('An active approval already exists. Cancel it before approving again.')
      saved = { ...candidate, approvalId: randomUUID(), approvedBy: actor, status: 'APPROVED' }
      await new sql.Request(tx).input('data',sql.NVarChar(sql.MAX),JSON.stringify(saved)).query(`
        INSERT dbo.MonthlyAvizPricingApprovals(approvalId,monthKey,centerCode,producerCode,milkType,centerName,producerName,approvedLiters,sourceFingerprint,approvedBy)
        SELECT approvalId,monthKey,centerCode,producerCode,milkType,centerName,producerName,approvedLiters,sourceFingerprint,approvedBy FROM OPENJSON(@data) WITH (
          approvalId uniqueidentifier,monthKey char(7),centerCode nvarchar(80),producerCode nvarchar(80),milkType nvarchar(40),
          centerName nvarchar(240),producerName nvarchar(240),approvedLiters decimal(18,3),sourceFingerprint char(64),approvedBy nvarchar(120));
        INSERT dbo.MonthlyAvizPricingApprovalLines(approvalId,jobId,rowNumber,noticeNumber,documentDate,approvedLiters,sourceFingerprint)
        SELECT JSON_VALUE(@data,'$.approvalId'),jobId,rowNumber,noticeNumber,documentDate,approvedLiters,sourceFingerprint
        FROM OPENJSON(@data,'$.lines') WITH (jobId nvarchar(64),rowNumber int,noticeNumber nvarchar(80),documentDate date,approvedLiters decimal(18,3),sourceFingerprint char(64));`)
      await audit('monthly_aviz_pricing.approve',saved.approvalId,saved)
      approvals.push(saved)
    } else if (action?.type === 'cancel') {
      const approval = approvals.find(a => code(a.approvalId) === code(action.approvalId))
      if (!approval) throw conflict('No active approval found.')
      const reason = String(action.reason || '').trim()
      if (!reason || reason.length > 1000) throw conflict('A cancellation reason of 1 to 1000 characters is required.')
      await new sql.Request(tx).input('id',sql.UniqueIdentifier,approval.approvalId).input('actor',sql.NVarChar(120),actor)
        .input('reason',sql.NVarChar(1000),reason).query(`UPDATE dbo.MonthlyAvizPricingApprovals SET status='CANCELLED',cancelledBy=@actor,
          cancelledAt=SYSDATETIMEOFFSET(),cancellationReason=@reason WHERE approvalId=@id`)
      approval.status = 'CANCELLED'
      await audit('monthly_aviz_pricing.cancel',approval.approvalId,{...approval,cancellationReason:reason})
    }
    await tx.commit()
    return { jobs, reconciliation, candidates, approvals: approvals.filter(a => a.status !== 'CANCELLED'), saved }
  } catch (error) { await tx.rollback(); throw error }
}
