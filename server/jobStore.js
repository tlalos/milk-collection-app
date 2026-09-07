import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deleteSqlJob,
  getSqlJob,
  initializeSqlOcrStore,
  isSqlOcrStoreEnabled,
  listSqlJobs,
  saveSqlJob,
} from './sqlOcrStore.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(rootDir, 'data', 'ocr')
const filesDir = path.join(dataDir, 'files')
const jobsDir = path.join(dataDir, 'jobs')

const extensions = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
])

export async function initializeJobStore() {
  await mkdir(filesDir, { recursive: true })
  if (isSqlOcrStoreEnabled()) {
    await initializeSqlOcrStore()
    return
  }
  await mkdir(jobsDir, { recursive: true })
}

function jobPath(id) {
  return path.join(jobsDir, `${id}.json`)
}

async function writeJob(job) {
  if (isSqlOcrStoreEnabled()) return saveSqlJob(job)
  const target = jobPath(job.id)
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(job, null, 2), 'utf8')
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temporary, target)
      return job
    } catch (error) {
      lastError = error
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }

  try {
    await copyFile(temporary, target)
    await rm(temporary, { force: true })
  } catch (fallbackError) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw fallbackError?.code ? fallbackError : lastError
  }
  return job
}

export async function createJob(file, documentCategory = 'daily_routes') {
  const id = randomUUID()
  const extension = extensions.get(file.mimetype)
  if (!extension) throw new Error(`Unsupported file type: ${file.mimetype}`)

  const storedFilename = `${id}${extension}`
  const storedFilePath = path.join(filesDir, storedFilename)
  await writeFile(storedFilePath, file.buffer)

  const now = new Date().toISOString()
  try {
    return await writeJob({
    id,
    sourceFile: file.originalname,
    storedFilename,
    mimeType: file.mimetype,
    size: file.size,
    documentCategory,
    status: 'queued',
    reviewStatus: 'pending',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    reviewedAt: null,
    data: null,
    ocrOriginalData: null,
    openai: null,
    excelExport: { status: 'not_ready', error: null },
    erpExport: { status: 'not_ready', error: null },
    centerMatches: [],
    centerMatchError: null,
    producerMatches: [],
    producerMatchError: null,
    headerCenterMatch: null,
    driverMatch: null,
    driverMatchError: null,
    vehicleMatch: null,
    vehicleMatchError: null,
    routeMatch: null,
    routeMatchError: null,
    rowValueSources: [],
    rowValueSourceError: null,
    error: null,
  })
  } catch (error) {
    await rm(storedFilePath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function getJob(id) {
  if (isSqlOcrStoreEnabled()) return getSqlJob(id)
  try {
    return JSON.parse(await readFile(jobPath(id), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function updateJob(id, updates) {
  const job = await getJob(id)
  if (!job) return null
  return writeJob({ ...job, ...updates, updatedAt: new Date().toISOString() })
}

export async function listJobs() {
  await initializeJobStore()
  if (isSqlOcrStoreEnabled()) return listSqlJobs()
  const filenames = (await readdir(jobsDir)).filter((filename) => filename.endsWith('.json'))
  const jobs = await Promise.all(filenames.map(async (filename) =>
    JSON.parse(await readFile(path.join(jobsDir, filename), 'utf8')),
  ))
  return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function getStoredFilePath(job) {
  if (!job?.storedFilename) return null
  return path.join(filesDir, job.storedFilename)
}

export async function deleteJob(id) {
  const job = await getJob(id)
  if (!job) return false
  const storedFilePath = getStoredFilePath(job)
  if (isSqlOcrStoreEnabled()) {
    await Promise.all([
      deleteSqlJob(id),
      storedFilePath ? rm(storedFilePath, { force: true }) : Promise.resolve(),
    ])
    return true
  }
  await Promise.all([rm(jobPath(id), { force: true }), storedFilePath ? rm(storedFilePath, { force: true }) : Promise.resolve()])
  return true
}

export function toPublicJob(job, includeData = true) {
  const { storedFilename: _storedFilename, ocrOriginalData: _ocrOriginalData, ...publicJob } = job
  if (!includeData) delete publicJob.data
  const rowCount = Array.isArray(job.data?.rows) ? job.data.rows.length : null
  const rowLitersTotal = Array.isArray(job.data?.rows)
    ? job.data.rows.reduce((total, row) => total + (typeof row.liters === 'number' && Number.isFinite(row.liters) ? row.liters : 0), 0)
    : null
  const uncertainFieldCount = job.data?.rows?.reduce(
    (total, row) => total + (row.uncertainFields?.length ?? 0),
    0,
  ) ?? 0
  const warningCount = job.data?.warnings?.length ?? 0
  return {
    ...publicJob,
    summary: {
      date: job.data?.date ?? null,
      documentMonth: job.data?.documentMonth ?? null,
      route: job.data?.route ?? null,
      layoutType: job.data?.layoutType ?? null,
      centerName: job.data?.headerCenterName ?? null,
      driverName: job.data?.driverName ?? null,
      vehicleRegistration: job.data?.vehicleRegistration ?? null,
      rowCount,
      totalLiters: typeof job.data?.totalLiters === 'number' && Number.isFinite(job.data.totalLiters)
        ? job.data.totalLiters
        : rowLitersTotal,
    },
    attention: {
      warningCount,
      uncertainFieldCount,
      needsAttention: job.reviewStatus === 'pending' && (warningCount > 0 || uncertainFieldCount > 0),
    },
    fileUrl: `${String(process.env.APP_BASE_PATH || '').replace(/\/$/u, '')}/api/ocr/jobs/${job.id}/file`,
  }
}
