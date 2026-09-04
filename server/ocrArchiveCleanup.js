import { access, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { getJob, getStoredFilePath, listJobs, updateJob } from './jobStore.js'
import { graphFetch, loadConfig, refreshAccessToken, resolveWorkbook } from './excelService.js'
import { readArchiveHistoryBuffer, upsertArchiveHistory } from './ocrArchiveHistory.js'

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'
const archiveCategories = new Set(['daily_routes', 'journal_monthly_settlement'])
let cleanupRunning = false

export function startOcrArchiveCleanup() {
  if (String(process.env.OCR_ARCHIVE_ENABLED || '').toLowerCase() !== 'true') return null

  const run = () => {
    void runOcrArchiveCleanup().catch((error) => {
      console.error(`[OCR archive cleanup] ${error instanceof Error ? error.message : 'Unexpected cleanup error.'}`)
    })
  }

  const initialDelayMs = Math.max(1, Number(process.env.OCR_ARCHIVE_INITIAL_DELAY_MINUTES || 5)) * 60 * 1000
  const intervalMs = Math.max(1, Number(process.env.OCR_ARCHIVE_INTERVAL_HOURS || 24)) * 60 * 60 * 1000
  const firstRun = setTimeout(run, initialDelayMs)
  const interval = setInterval(run, intervalMs)

  return () => {
    clearTimeout(firstRun)
    clearInterval(interval)
  }
}

export async function runOcrArchiveCleanup() {
  if (cleanupRunning) return { skipped: true, reason: 'already_running' }
  cleanupRunning = true
  const summary = { scanned: 0, archived: 0, failed: 0, skipped: 0 }

  try {
    const config = await loadConfig()
    if (!config.archiveEnabled) return { skipped: true, reason: 'disabled' }
    const cutoff = new Date(Date.now() - safeNumber(config.archiveMinAgeDays, 60) * 24 * 60 * 60 * 1000)
    const jobs = await listJobs()
    const token = await refreshAccessToken(config)
    const driveId = await resolveArchiveDriveId(config, token)

    for (const job of jobs) {
      summary.scanned += 1
      if (!isArchiveCandidate(job, cutoff)) {
        summary.skipped += 1
        continue
      }

      try {
        const freshJob = await getJob(job.id)
        if (!freshJob || !isArchiveCandidate(freshJob, cutoff)) {
          summary.skipped += 1
          continue
        }

        await archiveStoredJob(freshJob, config, driveId, token)
        summary.archived += 1
      } catch (error) {
        summary.failed += 1
        const attemptedAt = new Date().toISOString()
        const archiveStatus = {
          ...(job.archiveStatus || {}),
          status: 'failed',
          attemptedAt,
          error: error instanceof Error ? error.message : 'Archive upload failed.',
        }
        await updateJob(job.id, {
          archiveStatus,
        }).catch(() => undefined)
        await upsertArchiveHistory(archiveHistoryRecord(job, archiveStatus)).catch(() => undefined)
        await syncArchiveHistoryToSharePoint(config, driveId, token).catch(() => undefined)
      }
    }

    if (summary.archived || summary.failed) {
      console.log(`[OCR archive cleanup] archived=${summary.archived} failed=${summary.failed} skipped=${summary.skipped}`)
    }
    return summary
  } finally {
    cleanupRunning = false
  }
}

export async function archiveOcrJobNow(jobId) {
  if (cleanupRunning) {
    const error = new Error('OCR archive is already running. Please try again in a moment.')
    error.status = 409
    throw error
  }

  cleanupRunning = true
  try {
    const config = await loadConfig()
    if (!config.archiveEnabled) {
      const error = new Error('OCR archive is disabled in the server configuration.')
      error.status = 409
      throw error
    }

    const job = await getJob(jobId)
    if (!job) {
      const error = new Error('OCR job not found.')
      error.status = 404
      throw error
    }
    assertManualArchiveCandidate(job)

    const token = await refreshAccessToken(config)
    const driveId = await resolveArchiveDriveId(config, token)

    try {
      const archivedJob = await archiveStoredJob(job, config, driveId, token)
      return { job: archivedJob }
    } catch (error) {
      const attemptedAt = new Date().toISOString()
      const archiveStatus = {
        ...(job.archiveStatus || {}),
        status: 'failed',
        attemptedAt,
        error: error instanceof Error ? error.message : 'Archive upload failed.',
      }
      const updatedJob = await updateJob(job.id, { archiveStatus }).catch(() => job)
      await upsertArchiveHistory(archiveHistoryRecord(job, archiveStatus)).catch(() => undefined)
      await syncArchiveHistoryToSharePoint(config, driveId, token).catch(() => undefined)
      error.job = updatedJob
      throw error
    }
  } finally {
    cleanupRunning = false
  }
}

function isArchiveCandidate(job, cutoff) {
  if (!job?.storedFilename) return false
  if (job.archiveStatus?.status === 'archived') return false
  if (!archiveCategories.has(job.documentCategory || 'daily_routes')) return false
  if (job.status !== 'completed' || job.reviewStatus !== 'reviewed') return false
  const completedAt = Date.parse(job.completedAt || '')
  return Number.isFinite(completedAt) && completedAt <= cutoff.getTime()
}

function assertManualArchiveCandidate(job) {
  if (job.archiveStatus?.status === 'archived') {
    const error = new Error('This document is already archived to SharePoint.')
    error.status = 409
    throw error
  }
  if (!job.storedFilename) {
    const error = new Error('This document does not have a local source file to archive.')
    error.status = 409
    throw error
  }
  if (!archiveCategories.has(job.documentCategory || 'daily_routes')) {
    const error = new Error('This document type is not supported by OCR archiving.')
    error.status = 409
    throw error
  }
  if (job.status === 'queued' || job.status === 'processing') {
    const error = new Error('This document is still waiting or processing. Archive it after OCR finishes.')
    error.status = 409
    throw error
  }
}

async function archiveStoredJob(job, config, driveId, token) {
  const filePath = getStoredFilePath(job)
  await access(filePath)
  const folderPath = archiveFolderPath(config, job)
  await ensureFolderPath(driveId, folderPath, token)
  const archivedFileName = archiveFileName(job)
  const upload = await uploadArchiveFile(driveId, folderPath, archivedFileName, job, filePath, token)
  const archivedAt = new Date().toISOString()
  const archiveStatus = {
    status: 'archived',
    archivedAt,
    driveId,
    itemId: upload.id || null,
    webUrl: upload.webUrl || null,
    folderPath,
    archivedFileName: upload.name || archivedFileName,
    originalStoredFilename: job.storedFilename,
    sourceFile: job.sourceFile,
  }
  await upsertArchiveHistory(archiveHistoryRecord(job, archiveStatus))
  await rm(filePath, { force: true })
  const updatedJob = await updateJob(job.id, {
    storedFilename: null,
    archiveStatus,
  })
  await syncArchiveHistoryToSharePoint(config, driveId, token).catch((error) => {
    console.error(`[OCR archive cleanup] History backup upload failed: ${error instanceof Error ? error.message : 'Unexpected history backup error.'}`)
  })
  return updatedJob
}

async function resolveArchiveDriveId(config, token) {
  if (config.archiveDriveId) return config.archiveDriveId
  const workbook = await resolveWorkbook(config, token)
  return workbook.driveId
}

function archiveFolderPath(config, job) {
  const category = job.documentCategory || 'daily_routes'
  const configuredPath = category === 'journal_monthly_settlement'
    ? config.archiveMonthlyFolderPath
    : config.archiveDailyFolderPath
  if (configuredPath) return pathSegments(configuredPath).join('/')
  const categoryFolder = category === 'journal_monthly_settlement' ? 'journals' : 'daily'
  return pathSegments(config.archiveFolderPath, categoryFolder).join('/')
}

function archiveFileName(job) {
  const extension = path.extname(job.sourceFile || job.storedFilename || '') || path.extname(job.storedFilename || '')
  const timestamp = archiveTimestamp(job.completedAt || job.reviewedAt || job.createdAt)
  const shortId = String(job.id || '').slice(0, 8)
  const category = job.documentCategory || 'daily_routes'

  if (category === 'journal_monthly_settlement') {
    const centerName = job.headerCenterMatch?.selectedName || job.data?.headerCenterName || job.summary?.centerName || 'monthly-settlement'
    const safeCenter = sanitizePathSegment(centerName).slice(0, 90) || 'monthly-settlement'
    return `${safeCenter}_${timestamp}_${shortId}${extension || ''}`
  }

  const truck = job.vehicleMatch?.selectedValue || job.data?.vehicleRegistration || job.summary?.vehicleRegistration || 'unknown-truck'
  const safeTruck = sanitizePathSegment(truck).slice(0, 60) || 'unknown-truck'
  return `${timestamp}_${safeTruck}_${shortId}${extension || ''}`
}

async function ensureFolderPath(driveId, folderPath, token) {
  const segments = pathSegments(folderPath)
  let currentPath = ''
  for (const segment of segments) {
    const nextPath = currentPath ? `${currentPath}/${segment}` : segment
    try {
      await graphFetch(`/drives/${encodeURIComponent(driveId)}/root:/${encodeGraphPath(nextPath)}`, token)
    } catch (error) {
      if (Number(error?.status) !== 404) throw error
      const parentPath = currentPath
      const childrenPath = parentPath
        ? `/drives/${encodeURIComponent(driveId)}/root:/${encodeGraphPath(parentPath)}:/children`
        : `/drives/${encodeURIComponent(driveId)}/root/children`
      await graphFetch(childrenPath, token, {
        method: 'POST',
        body: JSON.stringify({
          name: segment,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      })
    }
    currentPath = nextPath
  }
}

async function uploadArchiveFile(driveId, folderPath, archivedFileName, job, filePath, token) {
  const targetPath = encodeGraphPath(`${folderPath}/${archivedFileName}`)
  const response = await fetch(`${GRAPH_ROOT}/drives/${encodeURIComponent(driveId)}/root:/${targetPath}:/content`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': job.mimeType || 'application/octet-stream',
    },
    body: await readFile(filePath),
  })
  const text = await response.text()
  let body = {}
  if (text) {
    try { body = JSON.parse(text) } catch { body = { message: text } }
  }
  if (!response.ok) {
    const error = new Error(body?.error?.message || body?.message || `SharePoint archive upload failed (${response.status}).`)
    error.status = response.status
    throw error
  }
  return body
}

async function syncArchiveHistoryToSharePoint(config, driveId, token) {
  const historyFilePath = archiveHistoryFilePath(config)
  const folderPath = pathSegments(historyFilePath).slice(0, -1).join('/')
  if (folderPath) await ensureFolderPath(driveId, folderPath, token)
  const targetPath = encodeGraphPath(historyFilePath)
  const response = await fetch(`${GRAPH_ROOT}/drives/${encodeURIComponent(driveId)}/root:/${targetPath}:/content`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: await readArchiveHistoryBuffer(),
  })
  const text = await response.text()
  if (!response.ok) {
    let body = {}
    if (text) {
      try { body = JSON.parse(text) } catch { body = { message: text } }
    }
    const error = new Error(body?.error?.message || body?.message || `SharePoint archive history upload failed (${response.status}).`)
    error.status = response.status
    throw error
  }
}

function archiveHistoryFilePath(config) {
  if (config.archiveHistoryFilePath) return pathSegments(config.archiveHistoryFilePath).join('/')
  return pathSegments(config.archiveFolderPath, 'archive-history.json').join('/')
}

function archiveHistoryRecord(job, archiveStatus) {
  const isMonthly = (job.documentCategory || 'daily_routes') === 'journal_monthly_settlement'
  return {
    jobId: job.id,
    documentCategory: job.documentCategory || 'daily_routes',
    documentType: isMonthly ? 'Monthly Settlement' : 'Daily Routes',
    status: archiveStatus.status,
    sourceFile: job.sourceFile || null,
    originalStoredFilename: archiveStatus.originalStoredFilename || job.storedFilename || null,
    archivedFileName: archiveStatus.archivedFileName || null,
    folderPath: archiveStatus.folderPath || null,
    webUrl: archiveStatus.webUrl || null,
    driveId: archiveStatus.driveId || null,
    itemId: archiveStatus.itemId || null,
    createdAt: job.createdAt || null,
    completedAt: job.completedAt || null,
    reviewedAt: job.reviewedAt || null,
    archivedAt: archiveStatus.archivedAt || null,
    attemptedAt: archiveStatus.attemptedAt || null,
    error: archiveStatus.error || null,
    driverName: job.data?.driverName || job.summary?.driverName || null,
    truckNumber: job.vehicleMatch?.selectedValue || job.data?.vehicleRegistration || job.summary?.vehicleRegistration || null,
    route: job.data?.route || job.summary?.route || null,
    headerCenterName: job.headerCenterMatch?.selectedName || job.data?.headerCenterName || job.summary?.centerName || null,
    documentMonth: job.data?.documentMonth || job.summary?.documentMonth || null,
    documentDate: job.data?.date || job.summary?.date || null,
  }
}

function pathSegments(...parts) {
  return parts
    .flatMap((part) => String(part || '').split(/[\\/]+/u))
    .map((part) => sanitizePathSegment(part))
    .filter(Boolean)
}

function sanitizePathSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/u, '')
}

function encodeGraphPath(value) {
  return pathSegments(value).map((segment) => encodeURIComponent(segment)).join('/')
}

function archiveTimestamp(value) {
  const date = new Date(value || Date.now())
  const valid = Number.isFinite(date.getTime()) ? date : new Date()
  return [
    valid.getFullYear(),
    String(valid.getMonth() + 1).padStart(2, '0'),
    String(valid.getDate()).padStart(2, '0'),
  ].join('-') + '_' + [
    String(valid.getHours()).padStart(2, '0'),
    String(valid.getMinutes()).padStart(2, '0'),
    String(valid.getSeconds()).padStart(2, '0'),
  ].join('-')
}

function safeNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}
