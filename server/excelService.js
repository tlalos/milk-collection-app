import { randomUUID } from 'node:crypto'
import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseEnv } from 'dotenv'

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'
const defaultExcelProject = 'C:\\Users\\tlalos\\Documents\\Codex\\2026-07-31\\excel-to-erp-soft1-codex-text\\excel-to-erp-soft1'
let centerCache = { expiresAt: 0, centers: [] }
let driverCache = { expiresAt: 0, drivers: [] }
let vehicleCache = { expiresAt: 0, vehicles: [] }
let vehicleRouteCache = { expiresAt: 0, routes: [] }
const DRIVER_CACHE_MS = 30 * 60 * 1000
let tokenRefreshPromise = null

export function clearReferenceCaches() {
  centerCache = { expiresAt: 0, centers: [] }
  driverCache = { expiresAt: 0, drivers: [] }
  vehicleCache = { expiresAt: 0, vehicles: [] }
  vehicleRouteCache = { expiresAt: 0, routes: [] }
}

async function loadConfig() {
  const projectDir = process.env.EXCEL_GRAPH_PROJECT_DIR || defaultExcelProject
  let inherited = {}
  try {
    inherited = parseEnv(await readFile(path.join(projectDir, '.env'), 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const env = { ...inherited, ...process.env }
  return {
    tenantId: env.AZURE_TENANT_ID || 'organizations',
    clientId: env.AZURE_CLIENT_ID,
    workbookUrl: env.GRAPH_WORKBOOK_URL,
    driveId: env.GRAPH_DRIVE_ID,
    itemId: env.GRAPH_ITEM_ID,
    scopes: env.GRAPH_SCOPES || 'Files.ReadWrite offline_access',
    tokenCachePath: env.EXCEL_GRAPH_TOKEN_CACHE || path.join(projectDir, '.graph-token-cache.json'),
    tableName: env.OCR_EXCEL_TABLE_NAME || 'tblDailyRoutes',
    sheetName: env.OCR_EXCEL_SHEET_NAME || 'Daily_Routes',
    milkCode: env.OCR_EXCEL_DEFAULT_MILK_CODE || 'MILK-COW',
    antibioticsStatus: env.OCR_EXCEL_ANTIBIOTICS_STATUS || 'OK',
  }
}

export async function appendReviewedDocumentToExcel(job, onProgress = async () => {}) {
  const config = await loadConfig()
  if (!config.clientId || (!config.workbookUrl && !(config.driveId && config.itemId))) {
    throw new Error('Excel Online is not configured with the Azure client and workbook target.')
  }
  if (!job.data?.rows?.length) throw new Error('The reviewed document has no collection rows to export.')

  const missingHeader = [
    ['date', job.data.date], ['driver', job.data.driverName], ['truck', job.data.vehicleRegistration], ['route', job.data.route],
  ].filter(([, value]) => !value).map(([name]) => name)
  if (missingHeader.length) throw new Error(`Cannot export: missing ${missingHeader.join(', ')}.`)

  const token = await refreshAccessToken(config)
  const workbook = await resolveWorkbook(config, token)
  const workbookPath = `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`
  // Sessionless range writes are substantially faster for this large, formula-heavy workbook.
  const headers = {}
  const tablePath = `${workbookPath}/tables/${encodeURIComponent(config.tableName)}`
  const columns = await graphFetch(`${tablePath}/columns`, token, { headers })
  const columnNames = (columns.value || []).map((column) => column.name)
  if (!columnNames.length) throw new Error(`Excel table ${config.tableName} has no columns.`)

  const rowIdRange = await graphFetch(`${tablePath}/columns/${encodeURIComponent('Row_ID')}/dataBodyRange`, token, { headers })
  const rowIdValues = (rowIdRange.values || []).flat()
  const existingIds = rowIdValues.map(Number).filter(Number.isFinite)
  let nextRowId = (existingIds.length ? Math.max(...existingIds) : 0) + 1
  const lastUsedIndex = rowIdValues.reduce((last, value, index) => value !== null && value !== '' ? index : last, -1)
  const startIndex = lastUsedIndex + 1
  const dateSerial = toExcelSerial(job.data.date)

  const values = []
  for (let index = 0; index < job.data.rows.length; index += 1) {
    const row = job.data.rows[index]
    const confirmedCenter = job.centerMatches?.find((match) => match.rowNumber === row.rowNumber && match.selectedCode)
    const missing = [
      ['center', row.collectionCenter], ['liters', row.liters], ['notice number', row.noticeNumber],
    ].filter(([, value]) => value === null || value === undefined || value === '').map(([name]) => name)
    if (missing.length) throw new Error(`Cannot export OCR row ${row.rowNumber}: missing ${missing.join(', ')}.`)

    const mapped = {
      Row_ID: nextRowId++,
      Date: dateSerial,
      Driver: job.data.driverName,
      Truck: job.data.vehicleRegistration,
      Route_ID: job.data.route,
      Aviz_No: row.noticeNumber,
      Center_Name: confirmedCenter?.selectedName || row.collectionCenter,
      Milk_Code: config.milkCode,
      Qty_Collected_L: row.liters,
      'Fat/Densitate': row.fatPercent ?? row.density,
      Temperature_C: row.temperature,
      Antibiotics_Status: config.antibioticsStatus,
      Water_Percent: row.water,
      Comments: '',
      ERP_Action: 'Create',
      ERP_Status: '',
      Center_Code: confirmedCenter?.selectedCode || null,
    }
    values.push(columnNames.slice(0, 14).map((name) => Object.hasOwn(mapped, name) ? mapped[name] : null))
    await onProgress({ stage: 'preparing', current: index + 1, total: job.data.rows.length, rowNumber: row.rowNumber, center: mapped.Center_Name })
  }

  if (startIndex + values.length > rowIdValues.length) {
    throw new Error(`Excel table ${config.tableName} has no remaining preallocated rows.`)
  }
  const bodyStartRow = Number(rowIdRange.address?.match(/![A-Z]+(\d+):/u)?.[1])
  if (!bodyStartRow) throw new Error('Could not determine the Daily_Routes table row address.')
  const excelStartRow = bodyStartRow + startIndex
  const excelEndRow = excelStartRow + values.length - 1
  const worksheets = await graphFetch(`${workbookPath}/worksheets`, token, { headers })
  const worksheet = (worksheets.value || []).find((item) => item.name.toLowerCase() === config.sheetName.toLowerCase())
  if (!worksheet) throw new Error(`Excel worksheet ${config.sheetName} was not found.`)
  const targetAddress = `A${excelStartRow}:N${excelEndRow}`
  await onProgress({ stage: 'sending', current: values.length, total: values.length, range: targetAddress })
  await graphFetch(`${workbookPath}/worksheets/${encodeURIComponent(worksheet.id)}/range(address='${targetAddress}')`, token, {
    method: 'PATCH', headers, body: JSON.stringify({ values }),
  })
  return { workbook: workbook.name, table: config.tableName, rowCount: values.length, range: targetAddress }
}

export async function matchCentersForRows(rows) {
  const centers = await loadReferenceCenters()
  return rows.map((row) => {
    const originalName = row.collectionCenter || ''
    const suggestions = centers
      .map((center) => ({ ...center, score: similarity(originalName, center.name) }))
      .filter((center) => center.score >= 0.32)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
      .map((center) => ({ code: center.code, name: center.name, score: Number(center.score.toFixed(3)) }))
    const best = suggestions[0]
    const autoReplace = best?.score >= 0.6
    return {
      rowNumber: row.rowNumber,
      originalName: row.collectionCenter,
      status: autoReplace ? 'auto_replaced' : suggestions.length ? 'suggested' : 'unmatched',
      selectedCode: autoReplace ? best.code : null,
      selectedName: autoReplace ? best.name : null,
      suggestions,
    }
  })
}

export async function listReferenceDrivers(query = '') {
  const drivers = await loadReferenceDrivers()
  const search = String(query || '').trim()
  if (!search) return drivers
  return drivers
    .map((name) => ({ name, score: driverSimilarity(search, name) }))
    .filter((driver) => normalizeValue(driver.name).includes(normalizeValue(search)) || driver.score >= 0.32)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 20)
    .map((driver) => driver.name)
}

export async function matchReferenceDriver(driverName) {
  const originalName = String(driverName || '').trim()
  if (!originalName) return { originalName: driverName || null, status: 'unmatched', selectedName: null, score: 0 }
  const drivers = await loadReferenceDrivers()
  const best = drivers
    .map((name) => ({ name, score: driverSimilarity(originalName, name) }))
    .sort((left, right) => right.score - left.score)[0]
  const autoReplace = best?.score >= 0.3
  return {
    originalName,
    status: autoReplace ? 'auto_replaced' : 'unmatched',
    selectedName: autoReplace ? best.name : null,
    score: Number((best?.score || 0).toFixed(3)),
  }
}

export async function listReferenceVehicles(query = '') {
  const vehicles = await loadReferenceVehicles()
  const search = String(query || '').trim()
  if (!search) return vehicles
  return vehicles
    .map((name) => ({ name, score: vehicleSimilarity(search, name) }))
    .filter((vehicle) => normalizeValue(vehicle.name).includes(normalizeValue(search)) || vehicle.score >= 0.3)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 20)
    .map((vehicle) => vehicle.name)
}

export async function matchReferenceVehicle(vehicleRegistration) {
  const originalValue = String(vehicleRegistration || '').trim()
  if (!originalValue) return { originalValue: vehicleRegistration || null, status: 'unmatched', selectedValue: null, score: 0 }
  const vehicles = await loadReferenceVehicles()
  const best = vehicles
    .map((value) => ({ value, score: vehicleSimilarity(originalValue, value) }))
    .sort((left, right) => right.score - left.score)[0]
  const autoReplace = best?.score >= 0.3
  return {
    originalValue,
    status: autoReplace ? 'auto_replaced' : 'unmatched',
    selectedValue: autoReplace ? best.value : null,
    score: Number((best?.score || 0).toFixed(3)),
  }
}

export async function resolveReferenceRoute(date, vehicleRegistration) {
  const vehicle = String(vehicleRegistration || '').trim()
  if (!date || !vehicle) return { status: 'unmatched', selectedRoute: null, date: date || null, vehicle: vehicle || null, existingRoutes: [] }
  const routeRows = await loadVehicleRouteOptions()
  const vehicleRoutes = routeRows.find((row) => normalizeValue(row.vehicle) === normalizeValue(vehicle))
  if (!vehicleRoutes) return { status: 'unmatched', selectedRoute: null, date, vehicle, existingRoutes: [] }

  const config = await loadConfig()
  const token = await refreshAccessToken(config)
  const workbook = await resolveWorkbook(config, token)
  const workbookPath = `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`
  const tablePath = `${workbookPath}/tables/${encodeURIComponent(config.tableName)}`
  const [columns, range] = await Promise.all([
    graphFetch(`${tablePath}/columns`, token),
    graphFetch(`${tablePath}/dataBodyRange`, token),
  ])
  const names = (columns.value || []).map((column) => String(column.name || '').trim().toLowerCase())
  const dateIndex = names.indexOf('date')
  const truckIndex = names.indexOf('truck')
  const routeIndex = names.indexOf('route_id')
  if (dateIndex < 0 || truckIndex < 0 || routeIndex < 0) throw new Error(`${config.tableName} must contain Date, Truck and Route_ID columns.`)
  const expectedSerial = toExcelSerial(date)
  const existingRoutes = [...new Set((range.values || [])
    .filter((row) => excelDateMatches(row[dateIndex], expectedSerial) && normalizeValue(row[truckIndex]) === normalizeValue(vehicleRoutes.vehicle))
    .map((row) => String(row[routeIndex] ?? '').trim())
    .filter(Boolean))]
  const options = vehicleRoutes.routes.filter(Boolean)
  const selectedRoute = options.find((route) => !existingRoutes.some((existing) => normalizeValue(existing) === normalizeValue(route))) || options.at(-1) || null
  return {
    status: selectedRoute ? 'resolved' : 'unmatched',
    selectedRoute,
    date,
    vehicle: vehicleRoutes.vehicle,
    existingRoutes,
    optionIndex: selectedRoute ? options.indexOf(selectedRoute) : null,
  }
}

export async function enrichMissingRowValues(data) {
  const fields = ['fatPercent', 'density', 'water', 'temperature']
  const invoiceValues = Object.fromEntries(fields.map((field) => {
    const sourceRow = [...data.rows].reverse().find((row) => row[field] !== null && row[field] !== undefined && row[field] !== '')
    return [field, sourceRow ? { value: sourceRow[field], rowNumber: sourceRow.rowNumber } : null]
  }))
  const needsPreviousDay = fields.filter((field) => !invoiceValues[field] && data.rows.some((row) => row[field] === null || row[field] === undefined || row[field] === ''))
  const previousDay = needsPreviousDay.length && data.date
    ? await loadPreviousDayRowValues(data.date, needsPreviousDay)
    : { date: null, values: {} }
  const noticeValue = formatNoticeDate(data.date)
  const rowValueSources = []
  const rows = data.rows.map((row) => {
    const next = { ...row }
    const fieldSources = {}
    for (const field of fields) {
      if (row[field] !== null && row[field] !== undefined && row[field] !== '') continue
      if (invoiceValues[field]) {
        next[field] = invoiceValues[field].value
        fieldSources[field] = {
          source: 'current_invoice',
          sourceRowNumber: invoiceValues[field].rowNumber,
          value: invoiceValues[field].value,
        }
      } else if (previousDay.values[field] !== null && previousDay.values[field] !== undefined && previousDay.values[field] !== '') {
        next[field] = previousDay.values[field]
        fieldSources[field] = {
          source: 'previous_day',
          sourceDate: previousDay.date,
          value: previousDay.values[field],
        }
      } else {
        fieldSources[field] = { source: 'not_found', sourceDate: data.date, value: null }
      }
    }
    if (!row.noticeNumber && noticeValue) {
      next.noticeNumber = noticeValue
      fieldSources.noticeNumber = { source: 'invoice_date', sourceDate: data.date, value: noticeValue }
    }
    if (Object.keys(fieldSources).length) rowValueSources.push({ rowNumber: row.rowNumber, fields: fieldSources })
    return next
  })
  return { data: { ...data, rows }, rowValueSources }
}

async function loadPreviousDayRowValues(date, requestedFields) {
  const config = await loadConfig()
  const token = await refreshAccessToken(config)
  const workbook = await resolveWorkbook(config, token)
  const workbookPath = `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`
  const tablePath = `${workbookPath}/tables/${encodeURIComponent(config.tableName)}`
  const [columns, range] = await Promise.all([
    graphFetch(`${tablePath}/columns`, token),
    graphFetch(`${tablePath}/dataBodyRange`, token),
  ])
  const names = (columns.value || []).map((column) => normalizeValue(column.name))
  const indexes = {
    date: names.findIndex((name) => name === 'DATE'),
    fatPercent: names.findIndex((name) => name.includes('FAT')),
    density: names.findIndex((name) => name === 'U G' || name === 'UG' || name === 'DENSITY' || name.includes('DENSITATE')),
    water: names.findIndex((name) => name.includes('WATER')),
    temperature: names.findIndex((name) => name.includes('TEMPERATURE')),
  }
  if (indexes.date < 0) throw new Error(`${config.tableName} must contain a Date column.`)
  const currentSerial = toExcelSerial(date)
  const datedRows = (range.values || []).map((row, index) => ({ row, index, serial: excelDateSerial(row[indexes.date]) }))
    .filter((item) => Number.isFinite(item.serial) && item.serial < currentSerial)
  const previousSerial = datedRows.reduce((latest, item) => Math.max(latest, item.serial), -Infinity)
  if (!Number.isFinite(previousSerial)) return { date: null, values: {} }
  const previousRows = datedRows.filter((item) => Math.round(item.serial) === Math.round(previousSerial)).sort((left, right) => right.index - left.index)
  const values = Object.fromEntries(requestedFields.map((field) => {
    const columnIndex = indexes[field]
    const source = columnIndex >= 0 ? previousRows.find((item) => item.row[columnIndex] !== null && item.row[columnIndex] !== undefined && item.row[columnIndex] !== '') : null
    return [field, source ? source.row[columnIndex] : null]
  }))
  return { date: excelSerialToIso(previousSerial), values }
}

async function loadReferenceCenters() {
  if (centerCache.expiresAt > Date.now()) return centerCache.centers
  const config = await loadConfig()
  const token = await refreshAccessToken(config)
  const workbook = await resolveWorkbook(config, token)
  const workbookPath = `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`
  const tablePath = `${workbookPath}/tables/${encodeURIComponent('tblCenters')}`
  const [columns, range] = await Promise.all([
    graphFetch(`${tablePath}/columns`, token),
    graphFetch(`${tablePath}/dataBodyRange`, token),
  ])
  const names = (columns.value || []).map((column) => column.name)
  const codeIndex = names.findIndex((name) => name.toLowerCase() === 'center_code')
  const nameIndex = names.findIndex((name) => name.toLowerCase() === 'center_name')
  if (codeIndex < 0 || nameIndex < 0) throw new Error('tblCenters must contain Center_Code and Center_Name columns.')
  const centers = (range.values || [])
    .map((values) => ({ code: String(values[codeIndex] ?? '').trim(), name: String(values[nameIndex] ?? '').trim() }))
    .filter((center) => center.code && center.name)
  centerCache = { expiresAt: Date.now() + 5 * 60 * 1000, centers }
  return centers
}

async function loadReferenceDrivers() {
  if (driverCache.expiresAt > Date.now()) return driverCache.drivers
  const config = await loadConfig()
  const token = await refreshAccessToken(config)
  const workbook = await resolveWorkbook(config, token)
  const workbookPath = `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`
  const worksheets = await graphFetch(`${workbookPath}/worksheets`, token)
  const worksheet = (worksheets.value || []).find((item) => item.name.toLowerCase() === 'dropdown_lists')
  if (!worksheet) throw new Error('Excel worksheet DropDown_Lists was not found.')
  const range = await graphFetch(`${workbookPath}/worksheets/${encodeURIComponent(worksheet.id)}/usedRange(valuesOnly=true)`, token)
  const values = range.values || []
  const candidates = values.flatMap((row, rowIndex) => row.flatMap((value, columnIndex) =>
    String(value || '').trim().toLowerCase() === 'driver' ? [{ headerRow: rowIndex, driverColumn: columnIndex }] : []))
  const candidate = candidates.sort((left, right) => right.driverColumn - left.driverColumn)[0]
  if (!candidate) throw new Error('DropDown_Lists must contain a Driver column.')
  const { headerRow, driverColumn } = candidate
  const drivers = [...new Set(values.slice(headerRow + 1)
    .map((row) => String(row[driverColumn] ?? '').trim())
    .filter(Boolean))]
  driverCache = { expiresAt: Date.now() + DRIVER_CACHE_MS, drivers }
  return drivers
}

async function loadReferenceVehicles() {
  if (vehicleCache.expiresAt > Date.now()) return vehicleCache.vehicles
  const config = await loadConfig()
  const token = await refreshAccessToken(config)
  const workbook = await resolveWorkbook(config, token)
  const workbookPath = `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`
  const worksheets = await graphFetch(`${workbookPath}/worksheets`, token)
  const worksheet = (worksheets.value || []).find((item) => item.name.toLowerCase() === 'dropdown_lists')
  if (!worksheet) throw new Error('Excel worksheet DropDown_Lists was not found.')
  const range = await graphFetch(`${workbookPath}/worksheets/${encodeURIComponent(worksheet.id)}/usedRange(valuesOnly=true)`, token)
  const values = range.values || []
  let headerRow = -1
  let vehicleColumn = -1
  for (let rowIndex = 0; rowIndex < values.length && headerRow < 0; rowIndex += 1) {
    const columnIndex = values[rowIndex].findIndex((value) => {
      const header = normalizeValue(value)
      return header === 'TRUCK' || header === 'VEHICLE' || header.includes('CAMION')
    })
    if (columnIndex >= 0) {
      headerRow = rowIndex
      vehicleColumn = columnIndex
    }
  }
  if (headerRow < 0) throw new Error('DropDown_Lists must contain a truck/vehicle column.')
  const vehicles = [...new Set(values.slice(headerRow + 1)
    .map((row) => String(row[vehicleColumn] ?? '').trim())
    .filter(Boolean))]
  vehicleCache = { expiresAt: Date.now() + DRIVER_CACHE_MS, vehicles }
  return vehicles
}

async function loadVehicleRouteOptions() {
  if (vehicleRouteCache.expiresAt > Date.now()) return vehicleRouteCache.routes
  const config = await loadConfig()
  const token = await refreshAccessToken(config)
  const workbook = await resolveWorkbook(config, token)
  const workbookPath = `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`
  const worksheets = await graphFetch(`${workbookPath}/worksheets`, token)
  const worksheet = (worksheets.value || []).find((item) => item.name.toLowerCase() === 'dropdown_lists')
  if (!worksheet) throw new Error('Excel worksheet DropDown_Lists was not found.')
  const range = await graphFetch(`${workbookPath}/worksheets/${encodeURIComponent(worksheet.id)}/usedRange(valuesOnly=true)`, token)
  const values = range.values || []
  const columnCount = Math.max(...values.map((row) => row.length), 0)
  const candidates = Array.from({ length: Math.max(columnCount - 1, 0) }, (_, vehicleColumn) => ({
    headerRow: 0,
    vehicleColumn,
    score: values.slice(1).filter((row) =>
      String(row[vehicleColumn] ?? '').trim() && /^R\d+/iu.test(String(row[vehicleColumn + 1] ?? '').trim())).length,
  }))
  const candidate = candidates.sort((left, right) => right.score - left.score)[0]
  if (!candidate || candidate.score === 0) throw new Error('DropDown_Lists must contain adjacent truck and route columns.')
  const { headerRow, vehicleColumn } = candidate
  const routes = values.slice(headerRow + 1)
    .map((row) => ({
      vehicle: String(row[vehicleColumn] ?? '').trim(),
      routes: [row[vehicleColumn + 1], row[vehicleColumn + 2], row[vehicleColumn + 3]].map((value) => String(value ?? '').trim()),
    }))
    .filter((row) => row.vehicle && row.routes.some(Boolean))
  vehicleRouteCache = { expiresAt: Date.now() + DRIVER_CACHE_MS, routes }
  return routes
}

function normalizeValue(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase().replace(/[^A-Z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ')
}

function similarity(leftValue, rightValue) {
  const left = normalizeValue(leftValue)
  const right = normalizeValue(rightValue)
  if (!left || !right) return 0
  if (left === right) return 1
  const distance = levenshtein(left, right)
  const characterScore = 1 - distance / Math.max(left.length, right.length)
  const leftTokens = new Set(left.split(' '))
  const rightTokens = new Set(right.split(' '))
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  const tokenScore = intersection / new Set([...leftTokens, ...rightTokens]).size
  const containment = left.includes(right) || right.includes(left) ? Math.min(left.length, right.length) / Math.max(left.length, right.length) : 0
  return Math.max(characterScore * 0.72 + tokenScore * 0.28, containment * 0.92)
}

function driverSimilarity(leftValue, rightValue) {
  const left = normalizeValue(leftValue)
  const right = normalizeValue(rightValue)
  const baseScore = similarity(left, right)
  if (!left || !right) return baseScore
  const leftTokens = left.split(' ')
  const rightTokens = right.split(' ')
  const wholeWordMatch = leftTokens.includes(right) || rightTokens.includes(left)
  const tokenScore = Math.max(...leftTokens.flatMap((leftToken) =>
    rightTokens.map((rightToken) => similarity(leftToken, rightToken))), 0)
  return Math.max(baseScore, wholeWordMatch ? 0.9 : 0, tokenScore >= 0.5 ? tokenScore : 0)
}

function vehicleSimilarity(leftValue, rightValue) {
  const left = normalizeValue(leftValue).replace(/\s+/gu, '')
  const right = normalizeValue(rightValue).replace(/\s+/gu, '')
  if (!left || !right) return 0
  if (left === right) return 1
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length)
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

function toExcelSerial(isoDate) {
  const parts = String(isoDate).split(/[-/]/u).map(Number)
  const [year, month, day] = parts[0] > 31 ? parts : [parts[2], parts[1], parts[0]]
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000
}

function excelDateSerial(value) {
  if (typeof value === 'number') return value
  return toExcelSerial(String(value || ''))
}

function excelSerialToIso(serial) {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10)
}

function formatNoticeDate(value) {
  const parts = String(value || '').split(/[-/]/u).map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null
  const [year, month, day] = parts[0] > 31 ? parts : [parts[2], parts[1], parts[0]]
  if (!year || !month || !day) return null
  return `${String(day).padStart(2, '0')}${String(month).padStart(2, '0')}${String(year).padStart(4, '0')}`
}

function excelDateMatches(value, expectedSerial) {
  if (typeof value === 'number') return Math.round(value) === Math.round(expectedSerial)
  const parsed = toExcelSerial(String(value || ''))
  return Number.isFinite(parsed) && Math.round(parsed) === Math.round(expectedSerial)
}

async function refreshAccessToken(config) {
  if (!tokenRefreshPromise) {
    tokenRefreshPromise = performTokenRefresh(config).finally(() => { tokenRefreshPromise = null })
  }
  return tokenRefreshPromise
}

async function performTokenRefresh(config) {
  const cached = JSON.parse(await readFile(config.tokenCachePath, 'utf8'))
  if (!cached.refresh_token) throw new Error('The Excel Graph token cache has no refresh token. Sign in from the Excel integration project first.')
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, scope: config.scopes, refresh_token: cached.refresh_token, grant_type: 'refresh_token' }),
  })
  const token = await parseResponse(response, 'refresh Microsoft Graph token')
  const temporary = `${config.tokenCachePath}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(token, null, 2), 'utf8')
  try {
    await rename(temporary, config.tokenCachePath)
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
    await copyFile(temporary, config.tokenCachePath)
    await rm(temporary, { force: true })
  }
  return token.access_token
}

async function resolveWorkbook(config, token) {
  if (config.driveId && config.itemId) return { driveId: config.driveId, itemId: config.itemId, name: config.itemId }
  const base64 = Buffer.from(config.workbookUrl, 'utf8').toString('base64')
  const shareId = `u!${base64.replace(/=+$/u, '').replace(/\//gu, '_').replace(/\+/gu, '-')}`
  const item = await graphFetch(`/shares/${shareId}/driveItem`, token, { headers: { Prefer: 'redeemSharingLinkIfNecessary' } })
  if (!item.parentReference?.driveId || !item.id) throw new Error('Could not resolve the Excel Online workbook.')
  return { driveId: item.parentReference.driveId, itemId: item.id, name: item.name }
}

async function graphFetch(pathname, token, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', ...options.headers }
  if (options.body) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${GRAPH_ROOT}${pathname}`, { ...options, headers })
  return parseResponse(response, `${options.method || 'GET'} ${pathname}`)
}

async function parseResponse(response, context) {
  const text = await response.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = { message: text } }
  }
  if (!response.ok) throw new Error(body?.error?.message || body?.error_description || body?.message || `${context} failed (${response.status}).`)
  return body || {}
}
