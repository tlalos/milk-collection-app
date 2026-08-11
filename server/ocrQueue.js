import { readFile } from 'node:fs/promises'
import { extractMilkCollectionDocument } from './ocrService.js'
import { getJob, getStoredFilePath, listJobs, updateJob } from './jobStore.js'
import { clearReferenceCaches, enrichMissingRowValues, matchCentersForRows, matchReferenceDriver, matchReferenceVehicle, resolveReferenceRoute } from './excelService.js'
import { rebuildVerificationWarnings } from './verification.js'

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
    // Every invoice must use the latest workbook reference values.
    clearReferenceCaches()
    let centerMatches = []
    let centerMatchError = null
    let driverMatch = null
    let driverMatchError = null
    let vehicleMatch = null
    let vehicleMatchError = null
    let routeMatch = null
    let routeMatchError = null
    let rowValueSources = []
    let rowValueSourceError = null
    try {
      centerMatches = await matchCentersForRows(extraction.data.rows)
    } catch (error) {
      centerMatchError = error instanceof Error ? error.message : 'Reference-center lookup failed.'
    }
    try {
      driverMatch = await matchReferenceDriver(extraction.data.driverName)
    } catch (error) {
      driverMatchError = error instanceof Error ? error.message : 'Reference-driver lookup failed.'
    }
    try {
      vehicleMatch = await matchReferenceVehicle(extraction.data.vehicleRegistration)
    } catch (error) {
      vehicleMatchError = error instanceof Error ? error.message : 'Reference-vehicle lookup failed.'
    }
    const matchedData = centerMatches.length ? {
      ...extraction.data,
      rows: extraction.data.rows.map((row) => {
        const match = centerMatches.find((item) => item.rowNumber === row.rowNumber && item.status === 'auto_replaced')
        return match?.selectedName ? { ...row, collectionCenter: match.selectedName } : row
      }),
    } : extraction.data
    const matchedDriverData = driverMatch?.status === 'auto_replaced' && driverMatch.selectedName
      ? { ...matchedData, driverName: driverMatch.selectedName }
      : matchedData
    const matchedVehicleData = vehicleMatch?.status === 'auto_replaced' && vehicleMatch.selectedValue
      ? { ...matchedDriverData, vehicleRegistration: vehicleMatch.selectedValue }
      : matchedDriverData
    try {
      routeMatch = await resolveReferenceRoute(matchedVehicleData.date, matchedVehicleData.vehicleRegistration)
    } catch (error) {
      routeMatchError = error instanceof Error ? error.message : 'Reference-route lookup failed.'
    }
    const matchedRouteData = routeMatch?.status === 'resolved' && routeMatch.selectedRoute
      ? { ...matchedVehicleData, route: routeMatch.selectedRoute }
      : matchedVehicleData
    let enrichedData = matchedRouteData
    try {
      const enrichment = await enrichMissingRowValues(matchedRouteData)
      enrichedData = enrichment.data
      rowValueSources = enrichment.rowValueSources
    } catch (error) {
      rowValueSourceError = error instanceof Error ? error.message : 'Row fallback lookup failed.'
    }
    enrichedData = {
      ...enrichedData,
      warnings: rebuildVerificationWarnings(enrichedData, { driverMatch, vehicleMatch, routeMatch, rowValueSources }),
    }
    await updateJob(id, {
      status: 'completed',
      data: enrichedData,
      ocrOriginalData: extraction.data,
      openai: extraction.openai,
      centerMatches,
      centerMatchError,
      driverMatch,
      driverMatchError,
      vehicleMatch,
      vehicleMatchError,
      routeMatch,
      routeMatchError,
      rowValueSources,
      rowValueSourceError,
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
