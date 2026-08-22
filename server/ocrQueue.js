import { readFile } from 'node:fs/promises'
import { extractMilkCollectionDocument } from './ocrService.js'
import { getJob, getStoredFilePath, listJobs, updateJob } from './jobStore.js'
import { clearReferenceCaches, enrichMissingRowValues, matchCentersForRows, matchMonthlyProducers, matchReferenceDriver, matchReferenceVehicle, resolveReferenceRoute } from './excelService.js'
import { rebuildVerificationWarnings } from './verification.js'
import { getOcrSettings } from './ocrSettingsStore.js'

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
  let attemptStartedAt = 0
  let attemptSettings = null
  try {
    const job = await getJob(id)
    if (!job || job.reviewStatus === 'reviewed') return

    attemptSettings = await getOcrSettings()
    attemptStartedAt = Date.now()
    await updateJob(id, { status: 'processing', startedAt: new Date(attemptStartedAt).toISOString(), error: null, openai: { provider: attemptSettings.provider, model: attemptSettings.model, usage: null, cost: null, durationMs: null } })
    const buffer = await readFile(getStoredFilePath(job))
    const extraction = await extractMilkCollectionDocument({
      buffer,
      mimetype: job.mimeType,
      originalname: job.sourceFile,
    }, job.documentCategory || 'daily_routes')
    if (job.documentCategory === 'journal_monthly_settlement') {
      clearReferenceCaches()
      let data = extraction.data
      let producerMatches = []
      let headerCenterMatch = null
      let producerMatchError = null
      try {
        const matches = await matchMonthlyProducers(data)
        producerMatches = matches.rows
        headerCenterMatch = matches.header
        data = {
          ...data,
          layoutType: matches.layoutType,
          headerCenterName: headerCenterMatch.status === 'auto_replaced' ? headerCenterMatch.selectedName : data.headerCenterName,
          rows: data.rows.map((row) => {
            const match = producerMatches.find((item) => item.rowNumber === row.rowNumber && item.status === 'auto_replaced')
            if (!match?.selectedName) return row
            return matches.layoutType === 'detailed' ? { ...row, producer: match.selectedName } : { ...row, centerName: match.selectedName }
          }),
        }
      } catch (error) { producerMatchError = error instanceof Error ? error.message : 'Ref_Producers lookup failed.' }
      await updateJob(id, {
        status: 'completed', data, ocrOriginalData: extraction.data, producerMatches, headerCenterMatch, producerMatchError,
        openai: { ...extraction.openai, durationMs: extraction.openai?.durationMs ?? Date.now() - attemptStartedAt }, completedAt: new Date().toISOString(), error: null,
      })
      return
    }
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
      openai: { ...extraction.openai, durationMs: extraction.openai?.durationMs ?? Date.now() - attemptStartedAt },
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
      ...(attemptSettings ? { openai: { provider: attemptSettings.provider, model: attemptSettings.model, usage: null, cost: null, durationMs: attemptStartedAt ? Date.now() - attemptStartedAt : null } } : {}),
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
