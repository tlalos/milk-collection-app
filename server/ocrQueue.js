import { readFile } from 'node:fs/promises'
import { extractMilkCollectionDocument } from './ocrService.js'
import { getJob, getStoredFilePath, listJobs, updateJob } from './jobStore.js'
import { matchCentersForRows } from './excelService.js'

const pendingIds = []
const queuedIds = new Set()
let processing = false

export function enqueueOcrJob(id) {
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
    if (!job || job.reviewStatus === 'reviewed') return

    await updateJob(id, { status: 'processing', startedAt: new Date().toISOString(), error: null })
    const buffer = await readFile(getStoredFilePath(job))
    const extraction = await extractMilkCollectionDocument({
      buffer,
      mimetype: job.mimeType,
      originalname: job.sourceFile,
    })
    let centerMatches = []
    let centerMatchError = null
    try {
      centerMatches = await matchCentersForRows(extraction.data.rows)
    } catch (error) {
      centerMatchError = error instanceof Error ? error.message : 'Reference-center lookup failed.'
    }
    const matchedData = centerMatches.length ? {
      ...extraction.data,
      rows: extraction.data.rows.map((row) => {
        const match = centerMatches.find((item) => item.rowNumber === row.rowNumber && item.status === 'auto_replaced')
        return match?.selectedName ? { ...row, collectionCenter: match.selectedName } : row
      }),
    } : extraction.data
    await updateJob(id, {
      status: 'completed',
      data: matchedData,
      openai: extraction.openai,
      centerMatches,
      centerMatchError,
      completedAt: new Date().toISOString(),
      error: null,
    })
  } catch (error) {
    await updateJob(id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'OCR extraction failed.',
    })
  } finally {
    processing = false
    void processNext()
  }
}

export async function resumePendingJobs() {
  const jobs = await listJobs()
  for (const job of jobs) {
    if (job.status === 'queued' || job.status === 'processing') {
      await updateJob(job.id, { status: 'queued' })
      enqueueOcrJob(job.id)
    }
  }
}
