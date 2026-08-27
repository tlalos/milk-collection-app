import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  await Promise.all([
    mkdir(filesDir, { recursive: true }),
    mkdir(jobsDir, { recursive: true }),
  ])
}

function jobPath(id) {
  return path.join(jobsDir, `${id}.json`)
}

async function writeJob(job) {
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
  await writeFile(path.join(filesDir, storedFilename), file.buffer)

  const now = new Date().toISOString()
  return writeJob({
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
}

export async function getJob(id) {
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
  const filenames = (await readdir(jobsDir)).filter((filename) => filename.endsWith('.json'))
  const jobs = await Promise.all(filenames.map(async (filename) =>
    JSON.parse(await readFile(path.join(jobsDir, filename), 'utf8')),
  ))
  return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function getStoredFilePath(job) {
  return path.join(filesDir, job.storedFilename)
}

export async function deleteJob(id) {
  const job = await getJob(id)
  if (!job) return false
  await Promise.all([
    rm(jobPath(id), { force: true }),
    rm(getStoredFilePath(job), { force: true }),
  ])
  return true
}

export function toPublicJob(job, includeData = true) {
  const { storedFilename: _storedFilename, ocrOriginalData: _ocrOriginalData, ...publicJob } = job
  if (!includeData) delete publicJob.data
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
    },
    attention: {
      warningCount,
      uncertainFieldCount,
      needsAttention: job.reviewStatus === 'pending' && (warningCount > 0 || uncertainFieldCount > 0),
    },
    fileUrl: `${String(process.env.APP_BASE_PATH || '').replace(/\/$/u, '')}/api/ocr/jobs/${job.id}/file`,
  }
}
