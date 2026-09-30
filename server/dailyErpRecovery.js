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

export function dailyErpRowSendBlocker(job, rowNumber) {
  if ((job.documentCategory || 'daily_routes') !== 'daily_routes' || job.status !== 'completed' || job.reviewStatus !== 'reviewed') return 'Mark the document reviewed in OCR first.'
  if (job.erpExport?.status === 'sending') return 'This document has an ERP send in progress or awaiting verification.'
  const previous = job.erpExport?.rowLog?.find(row => row.rowNumber === rowNumber)
  if (previous && previous.neverAttempted !== true) return 'ERP already attempted this row. Use Verify / recover row in OCR review.'
  if (previous?.documents?.some(doc => doc.status !== 'ready')) return 'Existing ERP result requires verification in OCR review.'
  if (job.erpExport?.status === 'sent') return 'This document has already been sent.'
  const row = job.data?.rows?.find(row => row.rowNumber === rowNumber)
  if (!row?.collectionCenter?.trim() || row.liters == null || !Number.isFinite(row.liters) || row.liters <= 0 || !String(row.noticeNumber || '').trim()) return 'Center, positive liters and aviz number are required.'
  const match = job.centerMatches?.find(match => match.rowNumber === rowNumber)
  const name = value => String(value || '').trim().replace(/\s+/gu, ' ').toUpperCase()
  if (!match?.selectedCode || name(match.selectedName) !== name(row.collectionCenter)) return 'Select a matching ERP center in OCR review first.'
  return null
}

export function prepareDailyErpRowSend(job, rowNumber, expectedSource) {
  const blocker = dailyErpRowSendBlocker(job, rowNumber)
  if (blocker) throw new Error(blocker)
  const source = dailyErpSource(job.data, job.centerMatches, rowNumber)
  if (JSON.stringify(source) !== JSON.stringify(expectedSource)) throw new Error('The row changed. Refresh Daily aviz before sending.')
  const state = structuredClone(job.erpExport || {})
  state.rowLog ??= []
  for (const row of job.data.rows) {
    if (!state.rowLog.some(entry => entry.rowNumber === row.rowNumber)) state.rowLog.push({
      rowNumber: row.rowNumber, center: row.collectionCenter, aviz: row.noticeNumber,
      status: 'ready', neverAttempted: true,
      documents: [{ kind: 'aviz', status: 'ready' }, { kind: 'nir', status: 'ready' }],
    })
  }
  const entry = state.rowLog.find(row => row.rowNumber === rowNumber)
  entry.neverAttempted = false
  entry.sourceSnapshot = source
  state.status = 'sending'
  state.error = null
  state.startedAt = new Date().toISOString()
  delete state.completedAt
  state.recoveryId = randomUUID()
  state.recoveryRowNumber = rowNumber
  state.initialRowNumber = rowNumber
  state.rowCount = job.data.rows.length
  return state
}

export function prepareDailyErpRecovery(job, request, now = new Date().toISOString()) {
  const documentCategory = job.documentCategory || 'daily_routes'
  if (documentCategory !== 'daily_routes' || job.status !== 'completed' || job.reviewStatus !== 'reviewed') {
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
  delete state.initialRowNumber
  row.neverAttempted = false
  if (state.status === 'sending') {
    state.startedAt = now
    delete state.completedAt
  }
  return state
}
