import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createJob,
  deleteJob,
  getJob,
  getStoredFilePath,
  initializeJobStore,
  listJobs,
  toPublicJob,
  updateJob,
} from './jobStore.js'
import { getSessionUser, initializeAuthStore, login, logout } from './authStore.js'
import { enqueueOcrJob, resumePendingJobs } from './ocrQueue.js'
import { enqueueExcelExport, resumeExcelExports } from './excelQueue.js'
import { MilkCollectionDocumentSchema } from './ocrSchema.js'
import { rebuildVerificationWarnings } from './verification.js'
import {
  clearReferenceCaches,
  enrichMissingRowValues,
  listReferenceDrivers,
  listReferenceVehicles,
  matchCentersForRows,
  matchReferenceDriver,
  matchReferenceVehicle,
  resolveReferenceRoute,
} from './excelService.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const appBasePath = normalizeBasePath(process.env.APP_BASE_PATH)
const appVersion = process.env.APP_VERSION || '2026.08.13.1'

function normalizeBasePath(value) {
  const normalized = String(value || '').trim().replace(/^\/+|\/+$/gu, '')
  return normalized ? `/${normalized}` : ''
}

function restorePreviouslyDerivedValues(submittedData, originalData, rowValueSources = []) {
  const restored = structuredClone(submittedData)
  for (const rowSource of rowValueSources || []) {
    const row = restored.rows.find((item) => item.rowNumber === rowSource.rowNumber)
    const originalRow = originalData.rows.find((item) => item.rowNumber === rowSource.rowNumber)
    if (!row || !originalRow) continue
    for (const [field, source] of Object.entries(rowSource.fields || {})) {
      if (String(row[field] ?? '') === String(source.value ?? '')) row[field] = originalRow[field] ?? null
    }
  }
  return restored
}

app.use((request, _response, next) => {
  if (appBasePath && (request.url === appBasePath || request.url.startsWith(`${appBasePath}/`))) {
    request.url = request.url.slice(appBasePath.length) || '/'
  }
  next()
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 15 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const supported = supportedTypes.has(file.mimetype)
    callback(supported ? null : new Error(`Unsupported file type: ${file.mimetype}`), supported)
  },
})

app.use(express.json({ limit: '1mb' }))

const cookieName = 'milk_session'
const sessionDays = Math.max(1, Number(process.env.AUTH_SESSION_DAYS || 30))
const cookiePath = appBasePath || '/'

function sessionToken(request) {
  const cookies = Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => {
    const separator = part.indexOf('=')
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1))]
  }))
  return cookies[cookieName] || ''
}

function cookieValue(token, maxAge) {
  const secure = String(process.env.AUTH_COOKIE_SECURE || '').toLowerCase() === 'true' ? '; Secure' : ''
  return `${cookieName}=${encodeURIComponent(token)}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const result = await login(request.body?.username, request.body?.password, sessionDays)
    if (!result) return response.status(401).json({ error: 'Invalid username or password.' })
    response.setHeader('Set-Cookie', cookieValue(result.token, sessionDays * 86400))
    response.json({ user: result.user, expiresAt: result.expiresAt })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/session', async (request, response, next) => {
  try {
    const user = await getSessionUser(sessionToken(request))
    if (!user) return response.status(401).json({ authenticated: false })
    response.json({ authenticated: true, user })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/logout', async (request, response, next) => {
  try {
    await logout(sessionToken(request))
    response.setHeader('Set-Cookie', cookieValue('', 0))
    response.json({ loggedOut: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/health', (_request, response) => {
  response.json({
    ok: true,
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_OCR_MODEL || 'gpt-5.6-terra',
    version: appVersion,
  })
})

app.use('/api/ocr', async (request, response, next) => {
  try {
    const user = await getSessionUser(sessionToken(request))
    if (!user) return response.status(401).json({ error: 'Authentication required.' })
    request.authUser = user
    next()
  } catch (error) {
    next(error)
  }
})

app.post('/api/ocr/jobs', upload.array('documents', 10), async (request, response, next) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return response.status(503).json({ error: 'OCR is not configured. Set OPENAI_API_KEY on the server.' })
    }
    if (!request.files?.length) {
      return response.status(400).json({ error: 'Add at least one document.' })
    }

    const jobs = []
    for (const file of request.files) {
      const job = await createJob(file)
      jobs.push(toPublicJob(job, false))
      enqueueOcrJob(job.id)
    }

    response.status(202).json({ jobs })
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/jobs', async (request, response, next) => {
  try {
    let jobs = await listJobs()
    if (request.query.reviewStatus) jobs = jobs.filter((job) => job.reviewStatus === request.query.reviewStatus)
    if (request.query.status) jobs = jobs.filter((job) => job.status === request.query.status)
    response.json({ jobs: jobs.map((job) => toPublicJob(job, false)) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/drivers', async (request, response, next) => {
  try {
    const drivers = await listReferenceDrivers(request.query.q)
    response.json({ drivers })
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/vehicles', async (request, response, next) => {
  try {
    const vehicles = await listReferenceVehicles(request.query.q)
    response.json({ vehicles })
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/jobs/:id', async (request, response, next) => {
  try {
    const job = await getJob(request.params.id)
    if (!job) return response.status(404).json({ error: 'OCR job not found.' })
    response.json({ job: toPublicJob(job, true) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/ocr/jobs/:id', async (request, response, next) => {
  try {
    const deleted = await deleteJob(request.params.id)
    if (!deleted) return response.status(404).json({ error: 'OCR job not found.' })
    response.json({ deleted: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/jobs/:id/file', async (request, response, next) => {
  try {
    const job = await getJob(request.params.id)
    if (!job) return response.status(404).json({ error: 'OCR job not found.' })
    response.type(job.mimeType)
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(job.sourceFile)}`)
    response.sendFile(getStoredFilePath(job))
  } catch (error) {
    next(error)
  }
})

app.patch('/api/ocr/jobs/:id', async (request, response, next) => {
  try {
    const current = await getJob(request.params.id)
    if (!current) return response.status(404).json({ error: 'OCR job not found.' })
    if (current.status !== 'completed') return response.status(409).json({ error: 'Only completed OCR jobs can be edited.' })

    const parsed = MilkCollectionDocumentSchema.safeParse(request.body.data)
    if (!parsed.success) {
      return response.status(400).json({
        error: 'Corrected document data is invalid.',
        details: parsed.error.issues,
      })
    }

    const centerMatches = Array.isArray(request.body.centerMatches)
      ? request.body.centerMatches.map((match) => ({
        rowNumber: Number(match.rowNumber),
        originalName: match.originalName ?? null,
        status: ['exact', 'auto_replaced', 'suggested', 'unmatched', 'confirmed'].includes(match.status) ? match.status : 'unmatched',
        selectedCode: match.selectedCode ? String(match.selectedCode) : null,
        selectedName: match.selectedName ? String(match.selectedName) : null,
        suggestions: Array.isArray(match.suggestions) ? match.suggestions.slice(0, 5) : [],
      }))
      : current.centerMatches
    const driverMatch = current.driverMatch?.status === 'auto_replaced' && parsed.data.driverName === current.driverMatch.selectedName
      ? current.driverMatch
      : current.driverMatch ? { ...current.driverMatch, status: 'manual' } : null
    const vehicleMatch = current.vehicleMatch?.status === 'auto_replaced' && parsed.data.vehicleRegistration === current.vehicleMatch.selectedValue
      ? current.vehicleMatch
      : current.vehicleMatch ? { ...current.vehicleMatch, status: 'manual' } : null
    const routeMatch = current.routeMatch?.status === 'resolved' && parsed.data.route === current.routeMatch.selectedRoute
      ? current.routeMatch
      : current.routeMatch ? { ...current.routeMatch, status: 'manual' } : null
    const data = {
      ...parsed.data,
      warnings: rebuildVerificationWarnings(parsed.data, {
        driverMatch,
        vehicleMatch,
        routeMatch,
        rowValueSources: current.rowValueSources,
      }),
    }
    const job = await updateJob(current.id, { data, centerMatches, driverMatch, vehicleMatch, routeMatch })
    response.json({ job: toPublicJob(job, true) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/ocr/jobs/:id/centers/match', async (request, response, next) => {
  try {
    const current = await getJob(request.params.id)
    if (!current) return response.status(404).json({ error: 'OCR job not found.' })
    if (!current.data?.rows) return response.status(409).json({ error: 'OCR data is not ready.' })
    const centerMatches = await matchCentersForRows(current.data.rows)
    const data = {
      ...current.data,
      rows: current.data.rows.map((row) => {
        const match = centerMatches.find((item) => item.rowNumber === row.rowNumber && item.status === 'auto_replaced')
        return match?.selectedName ? { ...row, collectionCenter: match.selectedName } : row
      }),
    }
    const job = await updateJob(current.id, { data, centerMatches, centerMatchError: null })
    response.json({ job: toPublicJob(job, true) })
  } catch (error) {
    const current = await getJob(request.params.id)
    if (current) await updateJob(current.id, { centerMatchError: error instanceof Error ? error.message : 'Reference-center lookup failed.' })
    next(error)
  }
})

app.post('/api/ocr/jobs/:id/centers/suggest', async (request, response, next) => {
  try {
    const current = await getJob(request.params.id)
    if (!current) return response.status(404).json({ error: 'OCR job not found.' })
    const rowNumber = Number(request.body.rowNumber)
    const name = String(request.body.name || '').trim()
    if (!Number.isFinite(rowNumber) || name.length < 3) return response.json({ match: null })
    const [match] = await matchCentersForRows([{ rowNumber, collectionCenter: name }])
    response.json({ match: match ? { ...match, status: match.suggestions.length ? 'suggested' : 'unmatched', selectedCode: null, selectedName: null } : null })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/ocr/jobs/:id/review', async (request, response, next) => {
  try {
    const current = await getJob(request.params.id)
    if (!current) return response.status(404).json({ error: 'OCR job not found.' })
    if (current.status !== 'completed') return response.status(409).json({ error: 'Only completed OCR jobs can be reviewed.' })

    const job = await updateJob(current.id, {
      reviewStatus: 'reviewed',
      reviewedAt: new Date().toISOString(),
      excelExport: { status: 'queued', queuedAt: new Date().toISOString(), error: null },
    })
    enqueueExcelExport(current.id)
    response.json({ job: toPublicJob(job, true) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/ocr/jobs/:id/excel/retry', async (request, response, next) => {
  try {
    const current = await getJob(request.params.id)
    if (!current) return response.status(404).json({ error: 'OCR job not found.' })
    if (current.reviewStatus !== 'reviewed') return response.status(409).json({ error: 'Review this document before exporting it to Excel.' })
    if (current.excelExport?.status === 'queued' || current.excelExport?.status === 'exporting') {
      return response.status(409).json({ error: 'Excel export is already in progress.' })
    }
    const job = await updateJob(current.id, { excelExport: { status: 'queued', queuedAt: new Date().toISOString(), error: null } })
    enqueueExcelExport(current.id)
    response.status(202).json({ job: toPublicJob(job, true) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/ocr/jobs/:id/references/rematch', async (request, response, next) => {
  try {
    const current = await getJob(request.params.id)
    if (!current) return response.status(404).json({ error: 'OCR job not found.' })
    if (current.status !== 'completed' || !current.data) {
      return response.status(409).json({ error: 'OCR data must be completed before Excel matching can run.' })
    }

    const parsedData = request.body?.data ? MilkCollectionDocumentSchema.safeParse(request.body.data) : null
    if (parsedData && !parsedData.success) {
      return response.status(400).json({ error: 'Document data is invalid.', details: parsedData.error.issues })
    }
    const submittedData = parsedData?.data || current.data
    const originalData = current.ocrOriginalData || current.data
    const sourceData = restorePreviouslyDerivedValues(submittedData, originalData, current.rowValueSources)
    clearReferenceCaches()

    const driverSource = current.driverMatch?.status === 'auto_replaced' && sourceData.driverName === current.data.driverName
      ? current.driverMatch.originalName
      : sourceData.driverName
    const vehicleSource = current.vehicleMatch?.status === 'auto_replaced' && sourceData.vehicleRegistration === current.data.vehicleRegistration
      ? current.vehicleMatch.originalValue
      : sourceData.vehicleRegistration
    let driverMatch = null
    let driverMatchError = null
    let vehicleMatch = null
    let vehicleMatchError = null
    let routeMatch = null
    let routeMatchError = null
    try { driverMatch = await matchReferenceDriver(driverSource) } catch (error) { driverMatchError = error instanceof Error ? error.message : 'Reference-driver lookup failed.' }
    try { vehicleMatch = await matchReferenceVehicle(vehicleSource) } catch (error) { vehicleMatchError = error instanceof Error ? error.message : 'Reference-vehicle lookup failed.' }
    const driverName = driverMatch?.status === 'auto_replaced' && driverMatch.selectedName
      ? driverMatch.selectedName
      : sourceData.driverName
    const vehicleRegistration = vehicleMatch?.status === 'auto_replaced' && vehicleMatch.selectedValue
      ? vehicleMatch.selectedValue
      : sourceData.vehicleRegistration
    try { routeMatch = await resolveReferenceRoute(sourceData.date, vehicleRegistration) } catch (error) { routeMatchError = error instanceof Error ? error.message : 'Reference-route lookup failed.' }
    const route = routeMatch?.status === 'resolved' && routeMatch.selectedRoute
      ? routeMatch.selectedRoute
      : sourceData.route
    let enrichedData = { ...sourceData, driverName, vehicleRegistration, route }
    let rowValueSources = []
    let rowValueSourceError = null
    try {
      const enrichment = await enrichMissingRowValues(enrichedData)
      enrichedData = enrichment.data
      rowValueSources = enrichment.rowValueSources
    } catch (error) {
      rowValueSourceError = error instanceof Error ? error.message : 'Row fallback lookup failed.'
    }
    enrichedData = {
      ...enrichedData,
      warnings: rebuildVerificationWarnings(enrichedData, { driverMatch, vehicleMatch, routeMatch, rowValueSources }),
    }
    const job = await updateJob(current.id, {
      data: enrichedData,
      ocrOriginalData: current.ocrOriginalData || current.data,
      driverMatch,
      driverMatchError,
      vehicleMatch,
      vehicleMatchError,
      routeMatch,
      routeMatchError,
      rowValueSources,
      rowValueSourceError,
    })
    response.json({ job: toPublicJob(job, true) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/ocr/jobs/:id/reprocess', async (request, response, next) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return response.status(503).json({ error: 'OCR is not configured. Set OPENAI_API_KEY on the server.' })
    }

    const current = await getJob(request.params.id)
    if (!current) return response.status(404).json({ error: 'OCR job not found.' })
    if (current.status === 'queued' || current.status === 'processing') {
      return response.status(409).json({ error: 'This document is already queued or being processed.' })
    }

    clearReferenceCaches()
    const job = await updateJob(current.id, {
      status: 'queued',
      reviewStatus: 'pending',
      startedAt: null,
      completedAt: null,
      reviewedAt: null,
      data: null,
      ocrOriginalData: null,
      openai: null,
      excelExport: { status: 'not_ready', error: null },
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
    enqueueOcrJob(current.id)
    response.status(202).json({ job: toPublicJob(job, false) })
  } catch (error) {
    next(error)
  }
})

app.use(express.static(path.join(rootDir, 'dist')))
app.use((request, response, next) => {
  if (request.method === 'GET' && request.accepts('html')) {
    return response.sendFile(path.join(rootDir, 'dist', 'index.html'))
  }
  next()
})

app.use((error, _request, response, _next) => {
  const status = error instanceof multer.MulterError ? 400 : 500
  response.status(status).json({ error: error instanceof Error ? error.message : 'Unexpected server error.' })
})

await initializeAuthStore()
await initializeJobStore()
await resumePendingJobs()
await resumeExcelExports()

app.listen(port, '0.0.0.0', () => {
  console.log(`MilkCollect server running at http://127.0.0.1:${port}`)
})
