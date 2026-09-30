import { randomUUID } from 'node:crypto'

export function dailyErpSource(data, centerMatches, rowNumber) {
  const row = data?.rows?.find(item => item.rowNumber === rowNumber)
  const match = centerMatches?.find(item => item.rowNumber === rowNumber)
  return {
    date: data?.date, route: data?.route, vehicleRegistration: data?.vehicleRegistration,
    centerCode: match?.selectedCode, centerName: row?.collectionCenter,
    liters: row?.liters, milkType: row?.milkType || 'MILK-COW', aviz: row?.noticeNumber,
    fatPercent: row?.fatPercent, density: row?.density, water: row?.water,
    temperature: row?.temperature, sampleId: row?.sampleId,
  }
}

export function prepareDailyErpRecovery(job, request, now = new Date().toISOString()) {
  if (job.documentCategory !== 'daily_routes' || job.status !== 'completed' || job.reviewStatus !== 'reviewed') {
    throw new Error('Only reviewed daily routes can be recovered.')
  }
  if (!request.confirmedStopped) throw new Error('Confirm the original ERP request has finished and is no longer running.')
  if (JSON.stringify(request.expectedData) !== JSON.stringify(job.data)) throw new Error('Document data changed. Reload and verify the saved values before recovery.')
  if (JSON.stringify(request.expectedExport) !== JSON.stringify(job.erpExport)) {
    throw new Error('ERP results changed. Reload the document and verify again.')
  }
  const state = structuredClone(job.erpExport)
  const row = state?.rowLog?.find(item => item.rowNumber === request.rowNumber)
  const source = job.data?.rows?.find(item => item.rowNumber === request.rowNumber)
  if (!row || !source) throw new Error('The original ERP row could not be found.')
  if (row.sourceSnapshot && JSON.stringify(row.sourceSnapshot) !== JSON.stringify(dailyErpSource(job.data, job.centerMatches, row.rowNumber))) {
    throw new Error('The row changed since the original ERP send. Restore the original values or investigate in ERP before recovery.')
  }
  if (row.center !== source.collectionCenter || String(row.aviz || '') !== String(source.noticeNumber || '')) {
    throw new Error('The center or aviz number changed since sending. Resolve this before recovery.')
  }
  if (row.status === 'sent' && !row.documents?.length) throw new Error('Legacy sent rows require separate ERP investigation.')
  row.documents ??= [{ kind: 'aviz', status: 'unconfirmed' }, { kind: 'nir', status: 'unconfirmed' }]
  if (row.documents.length !== 2 || !['aviz', 'nir'].every(kind => row.documents.some(doc => doc.kind === kind))) {
    throw new Error('Incomplete document history. Investigate before recovery.')
  }
  if (row.documents.every(doc => doc.status === 'sent')) throw new Error('Both documents are already sent.')
  for (const doc of row.documents) {
    if (doc.status === 'sent') continue
    const check = request.checks?.[doc.kind]
    if (!['found', 'absent'].includes(check?.outcome)) throw new Error(`Verify ${doc.kind.toUpperCase()} in ERP first.`)
    const id = String(check.erpId || '').trim()
    if (check.outcome === 'found' && !/^[1-9]\d*$/u.test(id)) throw new Error('Enter the existing numeric ERP document ID.')
    const { attempts = [], ...previous } = doc
    doc.attempts = [...attempts, previous]
    doc.manualVerification = { outcome: check.outcome, erpId: id || undefined, checkedAt: now, checkedBy: request.checkedBy || null }
    doc.status = check.outcome === 'found' ? 'sent' : 'ready'
    doc.newid = check.outcome === 'found' ? id : undefined
    doc.completedAt = check.outcome === 'found' ? now : undefined
    doc.message = check.outcome === 'found' ? 'Existing ERP document confirmed manually.' : 'Manually checked ERP: document not found.'
  }
  row.status = row.documents.every(doc => doc.status === 'sent') ? 'sent' : 'ready'
  row.message = 'Manual ERP verification recorded.'
  state.successCount = state.rowLog.filter(item => item.status === 'sent').length
  state.failedCount = state.rowLog.length - state.successCount
  state.status = row.status === 'sent' ? (state.failedCount ? 'partial' : 'sent') : 'sending'
  state.error = state.failedCount ? 'ERP recovery incomplete.' : null
  state.recoveryId = randomUUID()
  state.recoveryRowNumber = row.rowNumber
  return state
}
