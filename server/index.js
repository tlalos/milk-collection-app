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
import { archiveOcrJobNow, startOcrArchiveCleanup } from './ocrArchiveCleanup.js'
import { readArchiveHistory } from './ocrArchiveHistory.js'
import { MilkCollectionDocumentSchema, MonthlySettlementDocumentSchema, MonthlySettlementEditableDocumentSchema } from './ocrSchema.js'
import { rebuildVerificationWarnings } from './verification.js'
import { getOcrSettings, initializeOcrSettingsStore, isOcrProviderConfigured, OCR_PROVIDERS, publicOcrSettings, saveOcrSettings } from './ocrSettingsStore.js'
import { extractMilkCollectionDocument, normalizeMonthlyData } from './ocrService.js'
import {
  clearReferenceCaches,
  enrichMissingRowValues,
  listReferenceDrivers,
  listReferenceRoutes,
  listReferenceVehicleRoutes,
  listReferenceVehicles,
  matchCentersForRows,
  listReferenceProducers,
  matchMonthlyProducers,
  matchReferenceDriver,
  matchReferenceVehicle,
  resolveReferenceRoute,
} from './excelService.js'
import {
  createMilkReception,
  deleteMilkReception,
  deleteMilkReceptionDriver,
  deleteMilkReceptionRouteSetting,
  deleteMilkReceptionTruckRoutes,
  importMilkReceptionDrivers,
  importMilkReceptionRouteSettings,
  listMilkReceptionDrivers,
  listMilkReceptionRouteSettings,
  listMilkReceptions,
  milkReceptionOptions,
  replaceMilkReceptionTruckRoutes,
  updateMilkReception,
  upsertMilkReceptionDriver,
  upsertMilkReceptionRouteSetting,
} from './milkReceptionStore.js'
import { isSqlOcrStoreEnabled, listMonthlyProducerPricingRows } from './sqlOcrStore.js'
import { getPublicWeighbridgeConfig, getWeighbridgeConfig, readCurrentWeighbridgeWeight } from './weighbridgeService.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const appBasePath = normalizeBasePath(process.env.APP_BASE_PATH)
const appVersion = process.env.APP_VERSION || '2026.08.19.1'
const localDevOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5173',
  'http://localhost:5174',
])

function normalizeBasePath(value) {
  const normalized = String(value || '').trim().replace(/^\/+|\/+$/gu, '')
  return normalized ? `/${normalized}` : ''
}

function filterOptionValues(values, query = '') {
  const search = normalizeOptionValue(query)
  const filtered = search
    ? values.filter((value) => normalizeOptionValue(value).includes(search))
    : values
  return [...new Set(filtered.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
}

function normalizeOptionValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, ' ')
    .trim()
}

function normalizeSuggestionText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function addOcrOriginalCenterSuggestion(current, match, rowNumber, search) {
  const originalName = current.ocrOriginalData?.rows?.find((row) => Number(row.rowNumber) === Number(rowNumber))?.collectionCenter
  const original = normalizeSuggestionText(originalName)
  const typed = normalizeSuggestionText(search)
  if (!originalName || !typed) return match
  if (!original.startsWith(typed) && !original.includes(typed)) return match
  const alreadySuggested = match?.suggestions?.some((suggestion) => normalizeSuggestionText(suggestion.name) === original)
  if (alreadySuggested) return match
  const suggestion = { code: '__OCR_ORIGINAL__', name: originalName, score: 0, source: 'ocr_original' }
  const referenceSuggestions = match?.suggestions || []
  return {
    rowNumber,
    originalName: search,
    status: 'suggested',
    selectedCode: null,
    selectedName: null,
    suggestions: referenceSuggestions.length >= 5
      ? [...referenceSuggestions.slice(0, 4), suggestion]
      : [...referenceSuggestions, suggestion],
  }
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

function normalizeReconciliationKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '')
}

function normalizeReconciliationDate(value) {
  if (!value) return ''
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const two = (part) => String(part).padStart(2, '0')
    return `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}`
  }
  const text = String(value || '').trim()
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/u.exec(text)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  const displayMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(text)
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2].padStart(2, '0')}-${displayMatch[1].padStart(2, '0')}`
  const timestamp = Date.parse(text)
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const two = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

function finiteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function dailyAvizRowsFromJobs(jobs) {
  return jobs
    .filter((job) => (job.documentCategory || 'daily_routes') === 'daily_routes')
    .flatMap((job) => {
      const rows = Array.isArray(job.data?.rows) ? job.data.rows : []
      return rows.map((row) => ({
        jobId: job.id,
        sourceFile: job.sourceFile,
        date: normalizeReconciliationDate(job.data?.date),
        truck: job.data?.vehicleRegistration || '',
        truckKey: normalizeReconciliationKey(job.data?.vehicleRegistration),
        route: job.data?.route || '',
        routeKey: normalizeReconciliationKey(job.data?.route),
        driverName: job.data?.driverName || '',
        rowNumber: row.rowNumber ?? null,
        collectionCenter: row.collectionCenter || '',
        milkType: row.milkType || '',
        noticeNumber: row.noticeNumber || '',
        liters: finiteNumber(row.liters),
      }))
    })
}

function monthKeyFromDate(value) {
  const date = normalizeReconciliationDate(value)
  return date ? date.slice(0, 7) : ''
}

function compareReconciliationDetailRows(left, right) {
  const leftDate = normalizeReconciliationDate(left.documentDate)
  const rightDate = normalizeReconciliationDate(right.documentDate)
  if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate)
  if (leftDate && !rightDate) return -1
  if (!leftDate && rightDate) return 1
  return Number(left.rowNumber ?? 0) - Number(right.rowNumber ?? 0)
}

function monthKeyFromJob(job) {
  const dateMonth = monthKeyFromDate(job.data?.date)
  if (dateMonth) return dateMonth
  const month = finiteNumber(job.data?.documentMonth)
  if (!month || month < 1 || month > 12) return ''
  const created = new Date(job.createdAt || Date.now())
  const year = Number.isFinite(created.getTime()) ? created.getFullYear() : new Date().getFullYear()
  return `${year}-${String(month).padStart(2, '0')}`
}

function monthlyReconciliationKey(month, center, milkType) {
  const normalizedMilkType = normalizeMonthlyReconciliationMilkType(milkType)
  return [
    month,
    normalizeSuggestionText(center),
    normalizeSuggestionText(normalizedMilkType || 'UNSPECIFIED'),
  ].join('|')
}

function normalizeMonthlyReconciliationMilkType(value) {
  const normalized = normalizeSuggestionText(value)
  if (!normalized) return ''
  if (normalized.includes('BIVOL') || normalized.includes('BUFF')) return 'MILK-BUFF'
  if (normalized.includes('OAIE') || normalized.includes('OITA') || normalized.includes('SHEEP')) return 'MILK-SHEEP'
  if (normalized.includes('CAPRA') || normalized.includes('GOAT')) return 'MILK-GOAT'
  if (normalized.includes('VACA') || normalized.includes('COW')) return 'MILK-COW'
  if (['MILK COW', 'MILKCOW'].includes(normalized)) return 'MILK-COW'
  if (['MILK SHEEP', 'MILKSHEEP'].includes(normalized)) return 'MILK-SHEEP'
  if (['MILK GOAT', 'MILKGOAT'].includes(normalized)) return 'MILK-GOAT'
  if (['MILK BUFF', 'MILKBUFF'].includes(normalized)) return 'MILK-BUFF'
  return String(value || '').trim()
}

function addMonthlyReconciliationGroup(groups, month, center, milkType) {
  const displayCenter = String(center || '').trim() || 'Unassigned center'
  const displayMilkType = normalizeMonthlyReconciliationMilkType(milkType) || 'Unassigned milk type'
  const key = monthlyReconciliationKey(month, displayCenter, displayMilkType)
  if (!groups.has(key)) {
    groups.set(key, {
      id: key,
      month,
      center: displayCenter,
      milkType: displayMilkType,
      avizLiters: 0,
      monthlyLiters: 0,
      avizLineCount: 0,
      monthlyRowCount: 0,
      avizRows: [],
      monthlyRows: [],
    })
  }
  return groups.get(key)
}

function resolvedDailyAvizCenter(job, row) {
  const match = Array.isArray(job.centerMatches)
    ? job.centerMatches.find((item) => item.rowNumber === row.rowNumber)
    : null
  return match?.selectedName || row.collectionCenter
}

function originalDailyAvizCenter(job, row) {
  const originalRow = Array.isArray(job.ocrOriginalData?.rows)
    ? job.ocrOriginalData.rows.find((item) => Number(item.rowNumber) === Number(row.rowNumber))
    : null
  return originalRow?.collectionCenter || row.collectionCenter || null
}

function confirmedCenterMatchForRow(existingMatch, rowNumber, originalName, selectedName) {
  const suggestions = Array.isArray(existingMatch?.suggestions) ? existingMatch.suggestions : []
  const selectedSuggestion = suggestions.find((suggestion) => normalizeSuggestionText(suggestion.name) === normalizeSuggestionText(selectedName))
  return {
    ...(existingMatch || {}),
    rowNumber,
    originalName: existingMatch?.originalName || originalName || null,
    status: 'confirmed',
    selectedCode: selectedSuggestion?.code ? String(selectedSuggestion.code) : existingMatch?.selectedCode || null,
    selectedName,
    suggestions,
  }
}

function correctedDailyAvizJob(job, { month, fromCenter, milkType, toCenter }) {
  if ((job.documentCategory || 'daily_routes') !== 'daily_routes') return { updates: null, updatedRows: 0 }
  if (monthKeyFromDate(job.data?.date) !== month) return { updates: null, updatedRows: 0 }
  if (!Array.isArray(job.data?.rows)) return { updates: null, updatedRows: 0 }

  const fromKey = normalizeSuggestionText(fromCenter)
  const milkTypeKey = normalizeSuggestionText(normalizeMonthlyReconciliationMilkType(milkType))
  const affectedRows = []
  const rows = job.data.rows.map((row) => {
    const currentCenterKey = normalizeSuggestionText(resolvedDailyAvizCenter(job, row))
    const currentMilkTypeKey = normalizeSuggestionText(normalizeMonthlyReconciliationMilkType(row.milkType))
    if (currentCenterKey !== fromKey || currentMilkTypeKey !== milkTypeKey) return row
    affectedRows.push(row)
    return {
      ...row,
      collectionCenter: toCenter,
      uncertainFields: Array.isArray(row.uncertainFields)
        ? row.uncertainFields.filter((field) => field !== 'collectionCenter')
        : [],
    }
  })

  if (!affectedRows.length) return { updates: null, updatedRows: 0 }

  const matchesByRowNumber = new Map(
    (Array.isArray(job.centerMatches) ? job.centerMatches : []).map((match) => [Number(match.rowNumber), match]),
  )
  for (const row of affectedRows) {
    const rowNumber = Number(row.rowNumber)
    matchesByRowNumber.set(
      rowNumber,
      confirmedCenterMatchForRow(matchesByRowNumber.get(rowNumber), rowNumber, originalDailyAvizCenter(job, row), toCenter),
    )
  }

  const nextData = {
    ...job.data,
    rows,
  }
  return {
    updates: {
      data: {
        ...nextData,
        warnings: rebuildVerificationWarnings(nextData, {
          driverMatch: job.driverMatch,
          vehicleMatch: job.vehicleMatch,
          routeMatch: job.routeMatch,
          rowValueSources: job.rowValueSources,
        }),
      },
      ocrOriginalData: job.ocrOriginalData || job.data,
      centerMatches: [...matchesByRowNumber.values()].sort((left, right) => Number(left.rowNumber) - Number(right.rowNumber)),
    },
    updatedRows: affectedRows.length,
  }
}

function resolvedMonthlyJournalCenter(job, data, row) {
  return job.headerCenterMatch?.selectedName || data.headerCenterName || row.centerName
}

function monthlyProducerReferenceForRow(job, row) {
  const match = Array.isArray(job.producerMatches)
    ? job.producerMatches.find((item) => Number(item.rowNumber) === Number(row.rowNumber))
    : null
  const selectedCode = match?.selectedCode ? String(match.selectedCode).trim() : ''
  const selectedReference = selectedCode
    ? match?.suggestions?.find((item) => String(item.code).trim().toLocaleLowerCase() === selectedCode.toLocaleLowerCase())
    : null
  return {
    producerCode: selectedCode || null,
    producerName: match?.selectedName || selectedReference?.name || null,
    centerCode: selectedReference?.centerCode || null,
    centerName: selectedReference?.centerName || null,
  }
}

function monthlyReconciliationFromJobs(jobs) {
  const groups = new Map()
  const dailyJobs = jobs.filter((job) => (job.documentCategory || 'daily_routes') === 'daily_routes')
  const monthlyJobs = jobs.filter((job) => (job.documentCategory || 'daily_routes') === 'journal_monthly_settlement')

  for (const job of dailyJobs) {
    const month = monthKeyFromDate(job.data?.date)
    if (!month) continue
    const publicJob = toPublicJob(job, false)
    const rows = Array.isArray(job.data?.rows) ? job.data.rows : []
    for (const row of rows) {
      const liters = finiteNumber(row.liters)
      const center = resolvedDailyAvizCenter(job, row)
      const group = addMonthlyReconciliationGroup(groups, month, center, row.milkType)
      group.avizLiters += liters ?? 0
      group.avizLineCount += 1
      group.avizRows.push({
        id: `${job.id}-${row.rowNumber ?? group.avizRows.length + 1}`,
        jobId: job.id,
        sourceFile: job.sourceFile,
        fileUrl: publicJob.fileUrl,
        documentDate: job.data?.date ?? null,
        route: job.data?.route ?? null,
        driverName: job.data?.driverName ?? null,
        vehicleRegistration: job.data?.vehicleRegistration ?? null,
        rowNumber: row.rowNumber ?? null,
        noticeNumber: row.noticeNumber ?? null,
        liters,
      })
    }
  }

  for (const job of monthlyJobs) {
    const data = job.data ? normalizeMonthlyData(job.data) : null
    const month = monthKeyFromJob({ ...job, data })
    if (!data || !month) continue
    const publicJob = toPublicJob(job, false)
    const savedRows = Array.isArray(data.rows) ? data.rows : []
    const documentTotalLiters = finiteNumber(data.totalLiters)
    const rows = savedRows.length > 0
      ? savedRows
      : documentTotalLiters == null
        ? []
        : [{
            rowNumber: null,
            producer: null,
            centerName: data.headerCenterName,
            milkType: data.milkType,
            liters: documentTotalLiters,
            confidence: null,
          }]
    for (const row of rows) {
      const liters = finiteNumber(row.liters)
      const center = resolvedMonthlyJournalCenter(job, data, row)
      const producerReference = monthlyProducerReferenceForRow(job, row)
      const group = addMonthlyReconciliationGroup(groups, month, center, row.milkType || data.milkType)
      group.monthlyLiters += liters ?? 0
      group.monthlyRowCount += 1
      group.monthlyRows.push({
        id: `${job.id}-${row.rowNumber ?? group.monthlyRows.length + 1}`,
        jobId: job.id,
        sourceFile: job.sourceFile,
        fileUrl: publicJob.fileUrl,
        documentDate: data.date ?? null,
        rowNumber: row.rowNumber ?? null,
        producer: producerReference.producerName || row.producer || row.centerName || null,
        producerCode: producerReference.producerCode,
        centerName: center || null,
        milkType: row.milkType || data.milkType || null,
        liters,
        confidence: row.confidence ?? null,
      })
    }
  }

  const rows = [...groups.values()].map((group) => {
    const differenceLiters = group.monthlyLiters - group.avizLiters
    const differencePercent = group.avizLiters ? (differenceLiters / group.avizLiters) * 100 : null
    const status = group.avizLineCount === 0
      ? 'missing_aviz'
      : group.monthlyRowCount === 0
        ? 'missing_monthly'
        : Math.abs(differenceLiters) > 5
          ? 'difference'
          : 'ok'
    return {
      ...group,
      avizRows: [...group.avizRows].sort(compareReconciliationDetailRows),
      monthlyRows: [...group.monthlyRows].sort(compareReconciliationDetailRows),
      avizLiters: Number(group.avizLiters.toFixed(3)),
      monthlyLiters: Number(group.monthlyLiters.toFixed(3)),
      differenceLiters: Number(differenceLiters.toFixed(3)),
      differencePercent: differencePercent == null ? null : Number(differencePercent.toFixed(4)),
      status,
    }
  }).sort((left, right) => {
    if (left.month !== right.month) return right.month.localeCompare(left.month)
    const centerOrder = left.center.localeCompare(right.center, undefined, { numeric: true })
    if (centerOrder) return centerOrder
    return left.milkType.localeCompare(right.milkType, undefined, { numeric: true })
  })

  return {
    rows,
    summary: {
      groupCount: rows.length,
      okCount: rows.filter((row) => row.status === 'ok').length,
      differenceCount: rows.filter((row) => row.status === 'difference').length,
      missingMonthlyCount: rows.filter((row) => row.status === 'missing_monthly').length,
      missingAvizCount: rows.filter((row) => row.status === 'missing_aviz').length,
      totalAvizLiters: Number(rows.reduce((total, row) => total + row.avizLiters, 0).toFixed(3)),
      totalMonthlyLiters: Number(rows.reduce((total, row) => total + row.monthlyLiters, 0).toFixed(3)),
    },
  }
}

function previousMonthKey(month) {
  const match = /^(\d{4})-(\d{2})$/u.exec(String(month || ''))
  if (!match) return ''
  const year = Number(match[1])
  const monthNumber = Number(match[2])
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return ''
  const date = new Date(Date.UTC(year, monthNumber - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function producerPricingKey(month, producerCode, producer, milkType) {
  const producerIdentity = producerCode
    ? `CODE:${normalizeSuggestionText(producerCode)}`
    : `NAME:${normalizeSuggestionText(producer)}`
  return [
    month,
    producerIdentity,
    normalizeSuggestionText(normalizeMonthlyReconciliationMilkType(milkType) || 'UNSPECIFIED'),
  ].join('|')
}

function savedPricingKey(month, producerCode, milkType) {
  const code = String(producerCode || '').trim()
  if (!month || !code) return ''
  return [
    month,
    code.toLocaleLowerCase(),
    normalizeMonthlyReconciliationMilkType(milkType) || 'MILK-COW',
  ].join('|')
}

function pricingRowsByKey(rows) {
  return new Map(rows.map((row) => [savedPricingKey(row.monthKey, row.producerCode, row.milkType), row]).filter(([key]) => key))
}

function monthClosureSummary(rows) {
  return {
    rowCount: rows.length,
    centerCount: new Set(rows.map((row) => `${row.month}|${row.centerKey}`)).size,
    producerCount: new Set(rows.map((row) => `${row.month}|${row.producerKey}`)).size,
    totalLiters: Number(rows.reduce((total, row) => total + row.liters, 0).toFixed(3)),
    readyRowCount: rows.filter((row) => row.readyForPricing).length,
    blockedRowCount: rows.filter((row) => !row.readyForPricing).length,
  }
}

function monthClosurePricingFromJobs(jobs, filters = {}, pricingRows = []) {
  const reconciliation = monthlyReconciliationFromJobs(jobs)
  const reconciliationByGroup = new Map(reconciliation.rows.map((row) => [monthlyReconciliationKey(row.month, row.center, row.milkType), row]))
  const rowsByProducer = new Map()
  const savedPricing = pricingRowsByKey(pricingRows)

  for (const group of reconciliation.rows) {
    for (const journalRow of group.monthlyRows || []) {
      const producer = String(journalRow.producer || journalRow.centerName || group.center || '').trim() || 'Unassigned producer'
      const milkType = normalizeMonthlyReconciliationMilkType(journalRow.milkType || group.milkType) || group.milkType
      const producerCode = String(journalRow.producerCode || '').trim()
      const key = producerPricingKey(group.month, producerCode, producer, milkType)
      if (!rowsByProducer.has(key)) {
        rowsByProducer.set(key, {
          id: key,
          month: group.month,
          center: group.center,
          centerKey: normalizeSuggestionText(group.center),
          milkType,
          producer,
          producerCode,
          producerKey: normalizeSuggestionText(producer),
          liters: 0,
          sourceRowCount: 0,
          journalRows: [],
          reconciliationStatus: group.status,
          reconciliationDifferenceLiters: group.differenceLiters,
          centerAvizLiters: group.avizLiters,
          centerMonthlyLiters: group.monthlyLiters,
          centerJournalRows: group.monthlyRowCount,
          centerAvizLines: group.avizLineCount,
        })
      }
      const pricingRow = rowsByProducer.get(key)
      pricingRow.liters += finiteNumber(journalRow.liters) ?? 0
      pricingRow.sourceRowCount += 1
      pricingRow.journalRows.push(journalRow)
    }
  }

  const rows = [...rowsByProducer.values()].map((row) => {
    const previousMonth = previousMonthKey(row.month)
    const previousKey = producerPricingKey(previousMonth, row.producerCode, row.producer, row.milkType)
    const previous = rowsByProducer.get(previousKey)
    const pricing = savedPricing.get(savedPricingKey(row.month, row.producerCode, row.milkType))
    const previousPricing = savedPricing.get(savedPricingKey(previousMonth, row.producerCode, row.milkType))
    const group = reconciliationByGroup.get(monthlyReconciliationKey(row.month, row.center, row.milkType))
    const blocked = !group || group.status !== 'ok'
    return {
      ...row,
      liters: Number(row.liters.toFixed(3)),
      previousMonthLiters: previous ? Number(previous.liters.toFixed(3)) : null,
      previousMonthRowCount: previous?.sourceRowCount || 0,
      price: pricing?.responsiblePrice ?? null,
      commission: pricing?.receiverCommission ?? null,
      electricity: pricing?.electricity ?? null,
      responsibleComment: pricing?.responsibleComment ?? '',
      previousMonthPrice: previousPricing?.responsiblePrice ?? null,
      previousMonthCommission: previousPricing?.receiverCommission ?? null,
      previousMonthElectricity: previousPricing?.electricity ?? null,
      pricingStatus: blocked ? 'blocked' : pricing?.pricingStatus?.toLowerCase() === 'saved' ? 'saved' : 'needs_price',
      readyForPricing: !blocked,
    }
  }).sort((left, right) => {
    if (left.month !== right.month) return right.month.localeCompare(left.month)
    const centerOrder = left.center.localeCompare(right.center, undefined, { numeric: true })
    if (centerOrder) return centerOrder
    const producerOrder = left.producer.localeCompare(right.producer, undefined, { numeric: true })
    if (producerOrder) return producerOrder
    return left.milkType.localeCompare(right.milkType, undefined, { numeric: true })
  })

  const monthOptions = [...new Set(rows.map((row) => row.month).filter(Boolean))]
    .sort((left, right) => right.localeCompare(left))
  const requestedMonth = /^\d{4}-\d{2}$/u.test(String(filters.month || '')) ? String(filters.month) : ''
  const selectedMonth = requestedMonth || monthOptions[0] || ''
  const visibleRows = selectedMonth ? rows.filter((row) => row.month === selectedMonth) : rows

  return {
    rows: visibleRows,
    summary: monthClosureSummary(visibleRows),
    monthOptions,
    selectedMonth,
  }
}

function summarizeReceptionReconciliation(record, dailyRows) {
  const receptionLiters = finiteNumber(record.calculatedLiters)
  if (String(record.vehicleCategory || '').toUpperCase() === 'OTHER') {
    return {
      status: 'not_collection',
      label: 'Other',
      avizLiters: null,
      differenceLiters: null,
      differencePercent: null,
      matchedRowCount: 0,
      suggestedRoutes: [],
      matchedRows: [],
    }
  }

  const date = normalizeReconciliationDate(record.receptionDate)
  const truckKey = normalizeReconciliationKey(record.vehicleRegistration)
  const routeKey = normalizeReconciliationKey(record.routeId)
  if (!date || !truckKey || !routeKey) {
    return {
      status: 'missing_info',
      label: 'Missing info',
      avizLiters: null,
      differenceLiters: null,
      differencePercent: null,
      matchedRowCount: 0,
      suggestedRoutes: [],
      matchedRows: [],
    }
  }

  const truckRows = dailyRows.filter((row) => row.truckKey === truckKey)
  const truckDateRows = truckRows.filter((row) => row.date === date)
  const matchedRows = truckDateRows.filter((row) => row.routeKey === routeKey)
  const suggestedRoutes = [...new Set(truckDateRows.map((row) => row.route).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))

  if (!truckRows.length) {
    return {
      status: 'no_truck',
      label: 'No truck',
      avizLiters: null,
      differenceLiters: null,
      differencePercent: null,
      matchedRowCount: 0,
      suggestedRoutes,
      matchedRows: [],
    }
  }
  if (!matchedRows.length) {
    return {
      status: truckDateRows.length ? 'no_route' : 'no_date',
      label: truckDateRows.length ? 'No route' : 'No date',
      avizLiters: null,
      differenceLiters: null,
      differencePercent: null,
      matchedRowCount: 0,
      suggestedRoutes,
      matchedRows: [],
    }
  }

  const avizLiters = matchedRows.reduce((total, row) => total + (row.liters ?? 0), 0)
  const differenceLiters = receptionLiters == null ? null : receptionLiters - avizLiters
  const differencePercent = differenceLiters == null || avizLiters === 0 ? null : (differenceLiters / avizLiters) * 100
  const outsideTolerance = differenceLiters != null && Math.abs(differenceLiters) > 5
  return {
    status: outsideTolerance ? 'difference' : 'ok',
    label: outsideTolerance ? 'Diff' : 'OK',
    avizLiters,
    differenceLiters,
    differencePercent,
    matchedRowCount: matchedRows.length,
    suggestedRoutes,
    matchedRows: matchedRows.map((row) => ({
      rowNumber: row.rowNumber,
      center: row.collectionCenter,
      milkType: row.milkType,
      liters: row.liters,
      noticeNumber: row.noticeNumber,
      sourceFile: row.sourceFile,
    })),
  }
}

async function attachMilkReceptionReconciliations(records) {
  const dailyRows = dailyAvizRowsFromJobs(await listJobs())
  return records.map((record) => ({
    ...record,
    reconciliation: summarizeReceptionReconciliation(record, dailyRows),
  }))
}

app.use((request, response, next) => {
  const origin = request.headers.origin
  if (origin && localDevOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    if (request.method === 'OPTIONS') return response.sendStatus(204)
  }
  next()
})

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

app.get('/api/ocr/health', async (_request, response) => {
  const settings = await getOcrSettings()
  const provider = OCR_PROVIDERS[settings.provider]
  response.json({
    ok: true,
    configured: isOcrProviderConfigured(provider),
    provider: settings.provider,
    model: settings.model,
    version: appVersion,
  })
})

app.get('/api/weighbridge/current-weight', async (_request, response) => {
  try {
    const reading = await readCurrentWeighbridgeWeight()
    response.json({ ok: true, reading })
  } catch (error) {
    const config = getWeighbridgeConfig()
    response.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not read the weighbridge.',
      config: {
        enabled: config.enabled,
        portName: config.portName,
        baudRate: config.baudRate,
      },
    })
  }
})

app.get('/api/weighbridge/config', (_request, response) => {
  response.json({ ok: true, weighbridge: getPublicWeighbridgeConfig() })
})

app.get('/api/milk-receptions/options', async (_request, response) => {
  const warnings = []
  let vehicles = []
  let routes = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R20']
  let vehicleRoutes = []
  let routeSettings = { settings: [], vehicles: [], routes: [], vehicleRoutes: [] }
  let driverSettings = []
  try {
    routeSettings = await listMilkReceptionRouteSettings()
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Could not load truck-route settings.')
  }
  try {
    driverSettings = await listMilkReceptionDrivers()
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Could not load driver settings.')
  }
  const drivers = driverSettings.map((driver) => driver.driverName).filter(Boolean)

  if (routeSettings.vehicleRoutes.length) {
    vehicles = routeSettings.vehicles
    routes = routeSettings.routes
    vehicleRoutes = routeSettings.vehicleRoutes
    return response.json({ options: { ...milkReceptionOptions, vehicles, routes, vehicleRoutes, routeSettings: routeSettings.settings, driverSettings, drivers }, warnings })
  }

  try {
    vehicles = await listReferenceVehicles()
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Could not load vehicle reference list.')
  }
  try {
    routes = await listReferenceRoutes()
    vehicleRoutes = await listReferenceVehicleRoutes()
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Could not load route reference list.')
  }
  response.json({ options: { ...milkReceptionOptions, vehicles, routes, vehicleRoutes, routeSettings: routeSettings.settings, driverSettings, drivers }, warnings })
})

app.get('/api/milk-receptions/driver-settings', async (_request, response, next) => {
  try {
    response.json({ driverSettings: await listMilkReceptionDrivers() })
  } catch (error) {
    next(error)
  }
})

app.post('/api/milk-receptions/driver-settings', async (request, response, next) => {
  try {
    const user = await getSessionUser(sessionToken(request))
    const driver = await upsertMilkReceptionDriver(request.body, user?.username || '')
    response.status(201).json({ driver, driverSettings: await listMilkReceptionDrivers() })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/milk-receptions/driver-settings/:id', async (request, response, next) => {
  try {
    const deleted = await deleteMilkReceptionDriver(request.params.id)
    if (!deleted) return response.status(404).json({ error: 'Driver setting not found.' })
    response.json({ deleted: true, driverSettings: await listMilkReceptionDrivers() })
  } catch (error) {
    next(error)
  }
})

app.post('/api/milk-receptions/driver-settings/import-excel', async (request, response, next) => {
  try {
    const user = await getSessionUser(sessionToken(request))
    const drivers = await listReferenceDrivers()
    const result = await importMilkReceptionDrivers(drivers, user?.username || '')
    response.json({ result, driverSettings: await listMilkReceptionDrivers() })
  } catch (error) {
    next(error)
  }
})

app.get('/api/milk-receptions/route-settings', async (_request, response, next) => {
  try {
    response.json(await listMilkReceptionRouteSettings())
  } catch (error) {
    next(error)
  }
})

app.post('/api/milk-receptions/route-settings', async (request, response, next) => {
  try {
    const user = await getSessionUser(sessionToken(request))
    const setting = await upsertMilkReceptionRouteSetting(request.body, user?.username || '')
    response.status(201).json({ setting, ...(await listMilkReceptionRouteSettings()) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/milk-receptions/route-settings/:id', async (request, response, next) => {
  try {
    const deleted = await deleteMilkReceptionRouteSetting(request.params.id)
    if (!deleted) return response.status(404).json({ error: 'Truck-route setting not found.' })
    response.json({ deleted: true, ...(await listMilkReceptionRouteSettings()) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/milk-receptions/route-settings/truck/:vehicle', async (request, response, next) => {
  try {
    const deleted = await deleteMilkReceptionTruckRoutes(request.params.vehicle, request.query.vehicleCategory || request.body?.vehicleCategory)
    if (!deleted) return response.status(404).json({ error: 'Truck route setting not found.' })
    response.json({ deleted: true, ...(await listMilkReceptionRouteSettings()) })
  } catch (error) {
    next(error)
  }
})

app.put('/api/milk-receptions/route-settings/truck/:vehicle', async (request, response, next) => {
  try {
    const user = await getSessionUser(sessionToken(request))
    const result = await replaceMilkReceptionTruckRoutes(request.params.vehicle, request.body.routes, request.body.vehicleCategory, user?.username || '')
    response.json(result)
  } catch (error) {
    next(error)
  }
})

app.post('/api/milk-receptions/route-settings/import-excel', async (request, response, next) => {
  try {
    const user = await getSessionUser(sessionToken(request))
    const vehicleRoutes = await listReferenceVehicleRoutes()
    const result = await importMilkReceptionRouteSettings(vehicleRoutes, user?.username || '')
    response.json({ result, ...(await listMilkReceptionRouteSettings()) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/milk-receptions', async (request, response, next) => {
  try {
    const records = await listMilkReceptions({
      date: request.query.date,
      search: request.query.search,
    })
    response.json({ records: await attachMilkReceptionReconciliations(records) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/milk-receptions', async (request, response, next) => {
  try {
    const user = await getSessionUser(sessionToken(request))
    const record = await createMilkReception(request.body, user?.username || '')
    const [recordWithReconciliation] = await attachMilkReceptionReconciliations([record])
    response.status(201).json({ record: recordWithReconciliation })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/milk-receptions/:id', async (request, response, next) => {
  try {
    const user = await getSessionUser(sessionToken(request))
    const record = await updateMilkReception(request.params.id, request.body, user?.username || '')
    if (!record) return response.status(404).json({ error: 'Milk reception record not found.' })
    const [recordWithReconciliation] = await attachMilkReceptionReconciliations([record])
    response.json({ record: recordWithReconciliation })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/milk-receptions/:id', async (request, response, next) => {
  try {
    const deleted = await deleteMilkReception(request.params.id)
    if (!deleted) return response.status(404).json({ error: 'Milk reception record not found.' })
    response.json({ deleted: true })
  } catch (error) {
    next(error)
  }
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

app.get('/api/ocr/settings', async (_request, response, next) => {
  try { response.json({ settings: publicOcrSettings(await getOcrSettings()) }) } catch (error) { next(error) }
})

app.patch('/api/ocr/settings', async (request, response) => {
  try {
    const settings = await saveOcrSettings(String(request.body.provider || ''), String(request.body.model || ''))
    response.json({ settings: publicOcrSettings(settings) })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Could not save OCR settings.' })
  }
})

app.post('/api/ocr/compare', upload.single('document'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ error: 'Select an image or PDF to compare.' })
    const documentCategory = String(request.body?.documentCategory || '')
    if (!['daily_routes', 'journal_monthly_settlement'].includes(documentCategory)) {
      return response.status(400).json({ error: 'Select a valid document type.' })
    }
    const providerId = String(request.body?.provider || '')
    const model = String(request.body?.model || '')
    const provider = OCR_PROVIDERS[providerId]
    if (!provider || !provider.models.includes(model)) return response.status(400).json({ error: 'Select a valid OCR provider and model.' })
    if (!isOcrProviderConfigured(provider)) return response.status(503).json({ error: `${provider.label} OCR is not configured on the server.` })
    const started = Date.now()
    const extraction = await extractMilkCollectionDocument(request.file, documentCategory, { provider: providerId, model })
    response.json({
      result: {
        provider: providerId,
        providerLabel: provider.label,
        model,
        durationMs: extraction.openai?.durationMs ?? Date.now() - started,
        accounting: extraction.openai || null,
        data: extraction.data,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/ocr/jobs', upload.array('documents', 10), async (request, response, next) => {
  try {
    const settings = await getOcrSettings()
    const provider = OCR_PROVIDERS[settings.provider]
    if (!isOcrProviderConfigured(provider)) return response.status(503).json({ error: `${provider?.label || settings.provider} OCR is not configured on the server.` })
    if (!request.files?.length) {
      return response.status(400).json({ error: 'Add at least one document.' })
    }
    const documentCategory = String(request.body?.documentCategory || '')
    if (!['daily_routes', 'journal_monthly_settlement'].includes(documentCategory)) {
      return response.status(400).json({ error: 'Select a valid document type.' })
    }

    const jobs = []
    for (const file of request.files) {
      const job = await createJob(file, documentCategory)
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
    if (request.query.documentCategory) jobs = jobs.filter((job) => (job.documentCategory || 'daily_routes') === request.query.documentCategory)
    response.json({ jobs: jobs.map((job) => toPublicJob(job, false)) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/daily-aviz/rows', async (_request, response, next) => {
  try {
    const jobs = (await listJobs()).filter((job) => (job.documentCategory || 'daily_routes') === 'daily_routes')
    const rows = jobs.flatMap((job) => {
      const publicJob = toPublicJob(job, false)
      const dataRows = Array.isArray(job.data?.rows) ? job.data.rows : []
      return dataRows.map((row) => ({
        id: `${job.id}-${row.rowNumber}`,
        jobId: job.id,
        sourceFile: job.sourceFile,
        fileUrl: publicJob.fileUrl,
        documentDate: job.data?.date ?? null,
        route: job.data?.route ?? null,
        driverName: job.data?.driverName ?? null,
        vehicleRegistration: job.data?.vehicleRegistration ?? null,
        jobStatus: job.status,
        reviewStatus: job.reviewStatus,
        excelStatus: job.excelExport?.status ?? null,
        erpStatus: job.erpExport?.status ?? null,
        createdAt: job.createdAt,
        completedAt: job.completedAt ?? null,
        rowNumber: row.rowNumber ?? null,
        collectionCenter: row.collectionCenter ?? null,
        milkType: row.milkType ?? null,
        liters: row.liters ?? null,
        fatPercent: row.fatPercent ?? null,
        density: row.density ?? null,
        water: row.water ?? null,
        temperature: row.temperature ?? null,
        noticeNumber: row.noticeNumber ?? null,
        confidence: row.confidence ?? null,
        uncertainFields: Array.isArray(row.uncertainFields) ? row.uncertainFields : [],
      }))
    })
    const totalLiters = rows.reduce((total, row) => total + (typeof row.liters === 'number' && Number.isFinite(row.liters) ? row.liters : 0), 0)
    response.json({
      rows,
      summary: {
        documentCount: jobs.length,
        rowCount: rows.length,
        pendingDocumentCount: jobs.filter((job) => job.reviewStatus === 'pending').length,
        reviewedDocumentCount: jobs.filter((job) => job.reviewStatus === 'reviewed').length,
        failedDocumentCount: jobs.filter((job) => job.status === 'failed').length,
        totalLiters,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/monthly-reconciliation/rows', async (_request, response, next) => {
  try {
    response.json(monthlyReconciliationFromJobs(await listJobs()))
  } catch (error) {
    next(error)
  }
})

app.patch('/api/ocr/monthly-reconciliation/aviz-center', async (request, response, next) => {
  try {
    const month = String(request.body?.month || '').trim()
    const fromCenter = String(request.body?.fromCenter || '').trim()
    const milkType = String(request.body?.milkType || '').trim()
    const toCenter = String(request.body?.toCenter || '').trim()
    if (!/^\d{4}-\d{2}$/u.test(month)) return response.status(400).json({ error: 'Choose a valid month.' })
    if (!fromCenter) return response.status(400).json({ error: 'Choose the aviz center to change.' })
    if (!milkType) return response.status(400).json({ error: 'Choose the milk type to change.' })
    if (!toCenter) return response.status(400).json({ error: 'Choose the new center name.' })
    if (normalizeSuggestionText(fromCenter) === normalizeSuggestionText(toCenter)) {
      return response.status(400).json({ error: 'The new center name must be different.' })
    }

    let updatedJobs = 0
    let updatedRows = 0
    const jobs = await listJobs()
    for (const job of jobs) {
      const correction = correctedDailyAvizJob(job, { month, fromCenter, milkType, toCenter })
      if (!correction.updates || correction.updatedRows <= 0) continue
      await updateJob(job.id, correction.updates)
      updatedJobs += 1
      updatedRows += correction.updatedRows
    }

    if (!updatedRows) {
      return response.status(404).json({ error: 'No matching daily aviz rows were found for this correction.' })
    }

    response.json({
      updatedJobs,
      updatedRows,
      reconciliation: monthlyReconciliationFromJobs(await listJobs()),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/month-closure/pricing-rows', async (request, response, next) => {
  try {
    const jobs = await listJobs()
    const basePricing = monthClosurePricingFromJobs(jobs, { month: request.query.month })
    const pricingRows = isSqlOcrStoreEnabled() && basePricing.selectedMonth
      ? await listMonthlyProducerPricingRows([basePricing.selectedMonth, previousMonthKey(basePricing.selectedMonth)])
      : []
    response.json(monthClosurePricingFromJobs(jobs, { month: request.query.month }, pricingRows))
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
    const routeSettings = await listMilkReceptionRouteSettings()
    const vehicles = routeSettings.vehicles.length
      ? filterOptionValues(routeSettings.vehicles, request.query.q)
      : await listReferenceVehicles(request.query.q)
    response.json({ vehicles })
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/routes', async (request, response, next) => {
  try {
    const routeSettings = await listMilkReceptionRouteSettings()
    const vehicle = String(request.query.vehicle || '').trim()
    const savedVehicleRoutes = routeSettings.vehicleRoutes.find((item) => normalizeOptionValue(item.vehicle) === normalizeOptionValue(vehicle))
    const savedRoutes = savedVehicleRoutes?.routes?.length ? savedVehicleRoutes.routes : routeSettings.routes
    const routes = savedRoutes.length
      ? filterOptionValues(savedRoutes, request.query.q)
      : await listReferenceRoutes(vehicle)
    response.json({ routes })
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/producers', async (request, response, next) => {
  try {
    const producers = await listReferenceProducers(request.query.q, request.query.kind === 'center' ? 'center' : 'producer', request.query.headerCenter)
    response.json({ producers })
  } catch (error) { next(error) }
})

app.post('/api/ocr/jobs/:id/producers/rematch', async (request, response, next) => {
  try {
    const current = await getJob(request.params.id)
    if (!current) return response.status(404).json({ error: 'OCR job not found.' })
    if (current.documentCategory !== 'journal_monthly_settlement' || current.status !== 'completed' || !current.data) {
      return response.status(409).json({ error: 'A completed Monthly Settlement document is required.' })
    }
    clearReferenceCaches()
    const normalizedData = normalizeMonthlyData(current.data)
    const matches = await matchMonthlyProducers(normalizedData)
    const data = {
      ...normalizedData,
      layoutType: matches.layoutType,
      headerCenterName: matches.header.status === 'auto_replaced' ? matches.header.selectedName : current.data.headerCenterName,
      rows: normalizedData.rows.map((row) => {
        const match = matches.rows.find((item) => item.rowNumber === row.rowNumber && item.status === 'auto_replaced')
        if (!match?.selectedName) return row
        return { ...row, producer: match.selectedName }
      }),
    }
    const job = await updateJob(current.id, { data, producerMatches: matches.rows, headerCenterMatch: matches.header, producerMatchError: null })
    response.json({ job: toPublicJob(job, true) })
  } catch (error) {
    const current = await getJob(request.params.id)
    if (current) await updateJob(current.id, { producerMatchError: error instanceof Error ? error.message : 'Ref_Producers lookup failed.' })
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

app.post('/api/ocr/jobs/:id/archive', async (request, response, next) => {
  try {
    const result = await archiveOcrJobNow(request.params.id)
    response.json({ job: toPublicJob(result.job, true), archiveStatus: result.job.archiveStatus })
  } catch (error) {
    const status = Number(error?.status || 500)
    if (status >= 400 && status < 500) {
      return response.status(status).json({
        error: error instanceof Error ? error.message : 'Could not archive the document.',
        job: error?.job ? toPublicJob(error.job, true) : undefined,
      })
    }
    next(error)
  }
})

app.get('/api/ocr/jobs/:id/file', async (request, response, next) => {
  try {
    const job = await getJob(request.params.id)
    if (!job) return response.status(404).json({ error: 'OCR job not found.' })
    if (!job.storedFilename && job.archiveStatus?.status === 'archived') {
      return response.status(410).json({
        error: 'The source document was archived to SharePoint and is no longer stored locally.',
        archiveStatus: job.archiveStatus,
      })
    }
    const storedFilePath = getStoredFilePath(job)
    if (!storedFilePath) return response.status(404).json({ error: 'Source document file is not available.' })
    response.type(job.mimeType)
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(job.sourceFile)}`)
    response.sendFile(storedFilePath)
  } catch (error) {
    next(error)
  }
})

app.get('/api/ocr/archive-history', async (request, response, next) => {
  try {
    const history = await readArchiveHistory()
    response.json({
      ...history,
      records: history.records
        .slice()
        .sort((left, right) => String(right.updatedAt || right.archivedAt || right.attemptedAt || '').localeCompare(String(left.updatedAt || left.archivedAt || left.attemptedAt || ''))),
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/ocr/jobs/:id', async (request, response, next) => {
  try {
    const current = await getJob(request.params.id)
    if (!current) return response.status(404).json({ error: 'OCR job not found.' })
    if (current.status !== 'completed') return response.status(409).json({ error: 'Only completed OCR jobs can be edited.' })

    const isMonthlySettlement = current.documentCategory === 'journal_monthly_settlement'
    const schema = isMonthlySettlement ? MonthlySettlementEditableDocumentSchema : MilkCollectionDocumentSchema
    const submittedData = isMonthlySettlement
      ? {
        ...request.body.data,
        documentMonth: request.body.data?.documentMonth ?? null,
        totalLiters: request.body.data?.totalLiters ?? null,
        rows: Array.isArray(request.body.data?.rows)
          ? request.body.data.rows.map((row) => ({ ...row, milkType: row.milkType || request.body.data?.milkType || 'MILK-COW' }))
          : [],
      }
      : {
        ...request.body.data,
        rows: Array.isArray(request.body.data?.rows)
          ? request.body.data.rows.map((row) => ({ ...row, milkType: row.milkType || 'MILK-COW' }))
          : [],
      }
    const parsed = schema.safeParse(submittedData)
    if (!parsed.success) {
      return response.status(400).json({
        error: 'Corrected document data is invalid.',
        details: parsed.error.issues,
      })
    }

    if (current.documentCategory === 'journal_monthly_settlement') {
      let data = normalizeMonthlyData(parsed.data)
      let producerMatches = current.producerMatches || []
      let headerCenterMatch = current.headerCenterMatch || null
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
            return { ...row, producer: match.selectedName }
          }),
        }
      } catch (error) { producerMatchError = error instanceof Error ? error.message : 'Ref_Producers lookup failed.' }
      const job = await updateJob(current.id, { data, producerMatches, headerCenterMatch, producerMatchError })
      return response.json({ job: toPublicJob(job, true) })
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
    const erpExport = request.body.erpExport && typeof request.body.erpExport === 'object'
      ? request.body.erpExport
      : current.erpExport
    const job = await updateJob(current.id, { data, centerMatches, driverMatch, vehicleMatch, routeMatch, erpExport })
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
    const ocrFallbackMatch = addOcrOriginalCenterSuggestion(current, null, rowNumber, name)
    try {
      const [match] = await matchCentersForRows([{ rowNumber, collectionCenter: name }])
      const mergedMatch = addOcrOriginalCenterSuggestion(
        current,
        match ? { ...match, status: match.suggestions.length ? 'suggested' : 'unmatched', selectedCode: null, selectedName: null } : null,
        rowNumber,
        name,
      )
      response.json({ match: mergedMatch })
    } catch (error) {
      if (ocrFallbackMatch?.suggestions?.length) {
        response.json({
          match: ocrFallbackMatch,
          warning: error instanceof Error ? error.message : 'Reference-center lookup failed.',
        })
        return
      }
      response.json({
        match: {
          rowNumber,
          originalName: name,
          status: 'unmatched',
          selectedCode: null,
          selectedName: null,
          suggestions: [],
        },
        warning: error instanceof Error ? error.message : 'Reference-center lookup failed.',
      })
    }
  } catch (error) {
    next(error)
  }
})

app.patch('/api/ocr/jobs/:id/review', async (request, response, next) => {
  try {
    const current = await getJob(request.params.id)
    if (!current) return response.status(404).json({ error: 'OCR job not found.' })
    if (current.status !== 'completed') return response.status(409).json({ error: 'Only completed OCR jobs can be reviewed.' })
    const skipExcel = Boolean(request.body?.skipExcel)

    const job = await updateJob(current.id, {
      reviewStatus: 'reviewed',
      reviewedAt: new Date().toISOString(),
      excelExport: skipExcel
        ? { status: 'not_ready', reviewedWithoutExportAt: new Date().toISOString(), error: null }
        : { status: 'queued', queuedAt: new Date().toISOString(), error: null },
    })
    if (!skipExcel) enqueueExcelExport(current.id)
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
    const job = await updateJob(current.id, { excelExport: { ...current.excelExport, status: 'queued', queuedAt: new Date().toISOString(), error: null } })
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
    const settings = await getOcrSettings()
    const provider = OCR_PROVIDERS[settings.provider]
    if (!isOcrProviderConfigured(provider)) return response.status(503).json({ error: `${provider?.label || settings.provider} OCR is not configured on the server.` })

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

app.use('/api', (request, response) => {
  response.status(404).json({ error: `API endpoint not found: ${request.method} ${request.originalUrl}` })
})

app.use(express.static(path.join(rootDir, 'dist'), {
  setHeaders(response, filePath) {
    const fileName = path.basename(filePath).toLowerCase()
    if (fileName === 'index.html' || fileName === 'sw.js' || fileName === 'manifest.webmanifest') {
      response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    }
  },
}))
app.use((request, response, next) => {
  if (request.method === 'GET' && request.accepts('html')) {
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
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
await initializeOcrSettingsStore()
await resumePendingJobs()
await resumeExcelExports()
startOcrArchiveCleanup()

app.listen(port, '0.0.0.0', () => {
  console.log(`MilkCollect server running at http://127.0.0.1:${port}`)
})
