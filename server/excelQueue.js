import { appendMonthlySettlementToExcel, appendReviewedDocumentToExcel } from './excelService.js'
import { getJob, listJobs, updateJob } from './jobStore.js'

const pendingIds = []
const queuedIds = new Set()
let processing = false

export function enqueueExcelExport(id) {
  if (queuedIds.has(id)) return
  queuedIds.add(id)
  pendingIds.push(id)
  void processNext()
}

async function processNext() {
  if (processing) return
  const id = pendingIds.shift()
  if (!id) return
  processing = true
  queuedIds.delete(id)
  try {
    const job = await getJob(id)
    if (!job || job.reviewStatus !== 'reviewed' || job.excelExport?.status === 'exported') return
    const startedAt = new Date().toISOString()
    let rowLog = Array.isArray(job.excelExport?.rowLog)
      ? job.excelExport.rowLog.filter((row) => row.status === 'sent')
      : []
    await updateJob(id, { excelExport: { ...job.excelExport, status: 'exporting', startedAt, error: null, progress: { stage: 'connecting', current: 0, total: job.data?.rows?.length || 0 }, rowLog } })
    const exportDocument = job.documentCategory === 'journal_monthly_settlement' ? appendMonthlySettlementToExcel : appendReviewedDocumentToExcel
    const result = await exportDocument(job, async (progress) => {
      if (progress.stage === 'preparing' && !rowLog.some((row) => row.rowNumber === progress.rowNumber)) {
        rowLog = [...rowLog, { rowNumber: progress.rowNumber, center: progress.center, status: 'ready' }]
      }
      if (progress.stage === 'sent') {
        if (rowLog.some((row) => row.rowNumber === progress.rowNumber)) {
          rowLog = rowLog.map((row) => row.rowNumber === progress.rowNumber ? { ...row, status: 'sent', range: progress.range } : row)
        } else {
          rowLog = [...rowLog, { rowNumber: progress.rowNumber, center: progress.center, status: 'sent', range: progress.range }]
        }
      }
      await updateJob(id, { excelExport: { ...job.excelExport, status: 'exporting', startedAt, error: null, progress, rowLog } })
    })
    await updateJob(id, { excelExport: { status: 'exported', startedAt, completedAt: new Date().toISOString(), error: null, progress: { stage: 'completed', current: result.rowCount, total: result.rowCount }, rowLog: rowLog.map((row) => ({ ...row, status: 'sent' })), ...result } })
  } catch (error) {
    const job = await getJob(id)
    await updateJob(id, { excelExport: { ...job?.excelExport, status: 'failed', completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'Excel export failed.' } })
  } finally {
    processing = false
    void processNext()
  }
}

export async function resumeExcelExports() {
  const jobs = await listJobs()
  for (const job of jobs) {
    if (job.excelExport?.status === 'queued') enqueueExcelExport(job.id)
    if (job.excelExport?.status === 'exporting') {
      await updateJob(job.id, { excelExport: { ...job.excelExport, status: 'failed', error: 'Server restarted during export; retry after checking Excel to avoid duplicate rows.' } })
    }
  }
}
