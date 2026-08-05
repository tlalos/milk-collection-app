import { appendReviewedDocumentToExcel } from './excelService.js'
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
    await updateJob(id, { excelExport: { ...job.excelExport, status: 'exporting', startedAt: new Date().toISOString(), error: null } })
    const result = await appendReviewedDocumentToExcel(job)
    await updateJob(id, { excelExport: { status: 'exported', startedAt: job.excelExport?.startedAt || new Date().toISOString(), completedAt: new Date().toISOString(), error: null, ...result } })
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
