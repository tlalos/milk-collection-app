import { readFile } from 'node:fs/promises'
import { extractMilkCollectionDocument } from './ocrService.js'
import { getJob, getStoredFilePath, listJobs, updateJob } from './jobStore.js'

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
    await updateJob(id, {
      status: 'completed',
      data: extraction.data,
      openai: extraction.openai,
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
