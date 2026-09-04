import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseEnv } from 'dotenv'

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'
const defaultExcelProject = process.cwd()
const referenceCacheDir = path.join(defaultExcelProject, 'data', 'ocr', 'references')
const centerSnapshotPath = path.join(referenceCacheDir, 'centers.json')
let centerCache = { expiresAt: 0, centers: [] }
let driverCache = { expiresAt: 0, drivers: [] }
let vehicleCache = { expiresAt: 0, vehicles: [] }
let vehicleRouteCache = { expiresAt: 0, routes: [] }
let producerCache = { expiresAt: 0, producers: [] }
const DRIVER_CACHE_MS = 30 * 60 * 1000
let tokenRefreshPromise = null
const DAILY_ROUTES_USED_ROW_COLUMNS = [
  'Row_ID',
  'Date',
  'Driver',
  'Truck',
  'Route_ID',
  'Aviz_No',
  'Center_Name',
  'Qty_Collected_L',
  'Fat/Densitate',
  'Temperature_C',
  'Center_Code',
]
const MONTHLY_SETTLEMENT_USED_ROW_COLUMNS = [
  'Month',
  'Producer_Name',
  'Milk_Code',
  'Qty_Month_L',
  'Avg_Fat',
  'Producer_Comments',
  'jpg',
  'Producer_Code',
  'Producer_TRN',
  'Center_Code',
  'Center_Name',
]

export function clearReferenceCaches() {
  centerCache = { expiresAt: 0, centers: [] }
  driverCache = { expiresAt: 0, drivers: [] }
  vehicleCache = { expiresAt: 0, vehicles: [] }
  vehicleRouteCache = { expiresAt: 0, routes: [] }
  producerCache = { expiresAt: 0, producers: [] }
}

export async function loadConfig() {
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
    archiveEnabled: String(env.OCR_ARCHIVE_ENABLED || '').toLowerCase() === 'true',
    archiveDriveId: env.OCR_ARCHIVE_DRIVE_ID || '',
    archiveFolderPath: env.OCR_ARCHIVE_SHAREPOINT_FOLDER_PATH || 'pictures',
    archiveDailyFolderPath: env.OCR_ARCHIVE_DAILY_FOLDER_PATH || '',
    archiveMonthlyFolderPath: env.OCR_ARCHIVE_MONTHLY_FOLDER_PATH || '',
    archiveHistoryFilePath: env.OCR_ARCHIVE_HISTORY_FILE_PATH || '',
    archiveMinAgeDays: Number(env.OCR_ARCHIVE_MIN_AGE_DAYS || 60),
    archiveIntervalHours: Number(env.OCR_ARCHIVE_INTERVAL_HOURS || 24),
    archiveInitialDelayMinutes: Number(env.OCR_ARCHIVE_INITIAL_DELAY_MINUTES || 5),
  }
}

function assertExcelOnlineConfigured(config, feature = 'Excel Online') {
  const missing = []
  if (!config.clientId) missing.push('AZURE_CLIENT_ID')
  if (!config.workbookUrl && !(config.driveId && config.itemId)) missing.push('GRAPH_WORKBOOK_URL or GRAPH_DRIVE_ID/GRAPH_ITEM_ID')
  if (missing.length) {
    throw new Error(`${feature} is not configured on this PC. Add ${missing.join(', ')} to .env before using Excel reference matching or export.`)
  }
}

export async function appendReviewedDocumentToExcel(job, onProgress = async () => {}) {
  const config = await loadConfig()
  assertExcelOnlineConfigured(config, 'Excel export')
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

  const [rowIdRange, tableBodyRange] = await Promise.all([
    graphFetch(`${tablePath}/columns/${encodeURIComponent('Row_ID')}/dataBodyRange`, token, { headers }),
    graphFetch(`${tablePath}/dataBodyRange`, token, { headers }),
  ])
  const rowIdValues = (rowIdRange.values || []).flat()
  const tableBodyValues = Array.isArray(tableBodyRange.values) ? tableBodyRange.values : []
  const existingIds = rowIdValues.map(Number).filter(Number.isFinite)
  let nextRowId = (existingIds.length ? Math.max(...existingIds) : 0) + 1
  const lastUsedIndex = findLastUsedTableRowIndex(tableBodyValues, columnNames, DAILY_ROUTES_USED_ROW_COLUMNS)
  const startIndex = lastUsedIndex + 1
  const dateSerial = toExcelSerial(job.data.date)
  const bodyStartRow = Number(rowIdRange.address?.match(/![A-Z]+(\d+):/u)?.[1])
  if (!bodyStartRow) throw new Error('Could not determine the Daily_Routes table row address.')
  const values = []
  const rowInfos = []
  const rowsToExport = job.data.rows
  let preparedCount = 0
  for (const row of rowsToExport) {
    const confirmedCenter = job.centerMatches?.find((match) => match.rowNumber === row.rowNumber && match.selectedCode)
    const missing = [
      ['center', row.collectionCenter],
      ['liters', row.liters],
      ['fat', row.fatPercent],
      ['temperature', row.temperature],
      ['notice number', row.noticeNumber],
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
    const existingRowIndex = findExistingDailyRouteRowIndex(tableBodyValues, columnNames, mapped)
    if (existingRowIndex >= 0) {
      await onProgress({
        stage: 'sent',
        current: preparedCount,
        total: rowsToExport.length,
        rowNumber: row.rowNumber,
        center: mapped.Center_Name,
        range: `A${bodyStartRow + existingRowIndex}:N${bodyStartRow + existingRowIndex}`,
      })
      continue
    }
    values.push(columnNames.slice(0, 14).map((name) => Object.hasOwn(mapped, name) ? mapped[name] : null))
    rowInfos.push({ rowNumber: row.rowNumber, center: mapped.Center_Name })
    preparedCount += 1
    await onProgress({ stage: 'preparing', current: preparedCount, total: rowsToExport.length, rowNumber: row.rowNumber, center: mapped.Center_Name })
  }
  if (!values.length) return { workbook: workbook.name, table: config.tableName, rowCount: 0, range: '' }

  const excelStartRow = bodyStartRow + startIndex
  const excelEndRow = excelStartRow + values.length - 1
  const worksheets = await graphFetch(`${workbookPath}/worksheets`, token, { headers })
  const worksheet = (worksheets.value || []).find((item) => item.name.toLowerCase() === config.sheetName.toLowerCase())
  if (!worksheet) throw new Error(`Excel worksheet ${config.sheetName} was not found.`)
  const targetAddress = `A${excelStartRow}:N${excelEndRow}`
  await onProgress({ stage: 'sending', current: values.length, total: values.length, range: targetAddress })
  await writeWorksheetRows(workbookPath, worksheet.id, token, excelStartRow, 'A', 'N', values, rowInfos, onProgress, headers)
  return { workbook: workbook.name, table: config.tableName, rowCount: values.length, range: targetAddress }
}

export async function appendMonthlySettlementToExcel(job, onProgress = async () => {}) {
  if (!job.data?.rows?.length) throw new Error('The reviewed monthly settlement has no rows to export.')
  if (!job.data.date) throw new Error('Cannot export: the monthly settlement date is missing.')
  const config = await loadConfig()
  assertExcelOnlineConfigured(config, 'Monthly settlement Excel export')
  const token = await refreshAccessToken(config)
  const workbook = await resolveWorkbook(config, token)
  const workbookPath = `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`
  const tableName = 'tblMonthlySettlement'
  const tablePath = `${workbookPath}/tables/${encodeURIComponent(tableName)}`
  const [columns, monthRange, tableBodyRange] = await Promise.all([
    graphFetch(`${tablePath}/columns`, token),
    graphFetch(`${tablePath}/columns/${encodeURIComponent('Month')}/dataBodyRange`, token),
    graphFetch(`${tablePath}/dataBodyRange`, token),
  ])
  const columnNames = (columns.value || []).map((column) => column.name)
  const monthValues = (monthRange.values || []).flat()
  const tableBodyValues = Array.isArray(tableBodyRange.values) ? tableBodyRange.values : []
  const lastUsedIndex = findLastUsedTableRowIndex(tableBodyValues, columnNames, MONTHLY_SETTLEMENT_USED_ROW_COLUMNS)
  const startIndex = lastUsedIndex + 1
  const monthSerial = toExcelSerial(job.data.date)
  const milkCode = monthlyMilkCode(job.data.milkType)
  const sentRowNumbers = previouslySentRowNumbers(job)
  const rowsToExport = job.data.rows.filter((row) => !sentRowNumbers.has(row.rowNumber))
  if (!rowsToExport.length) return { workbook: workbook.name, table: tableName, worksheet: '', rowCount: 0, range: '' }

  const values = []
  const rowInfos = []
  for (let index = 0; index < rowsToExport.length; index += 1) {
    const row = rowsToExport[index]
    const match = job.producerMatches?.find((item) => item.rowNumber === row.rowNumber)
    const matchedRef = match?.suggestions?.find((item) => item.code === match.selectedCode) || null
    const producerName = match?.selectedName || (job.data.layoutType === 'detailed' ? row.producer : row.centerName)
    if (!producerName) throw new Error(`Cannot export monthly row ${row.rowNumber}: producer name is missing.`)
    if (row.liters === null || row.liters === undefined) throw new Error(`Cannot export monthly row ${row.rowNumber}: liters are missing.`)
    const centerName = job.headerCenterMatch?.selectedName || matchedRef?.centerName || job.data.headerCenterName || null
    const centerCode = job.headerCenterMatch?.selectedCode || matchedRef?.centerCode || null
    const mapped = {
      Month: monthSerial,
      Producer_Name: producerName,
      Milk_Code: milkCode,
      Qty_Month_L: row.liters,
      Avg_Fat: job.data.layoutType === 'detailed' ? row.ugPercent : row.gValue,
      Producer_Comments: `OCR ${job.data.layoutType}; source ${job.sourceFile}`,
      jpg: job.sourceFile,
      Column2: '',
      'telikos elegxow ': '',
      Producer_Code: match?.selectedCode || null,
      Producer_TRN: matchedRef?.trn || null,
      Center_Code: centerCode,
      Center_Name: centerName,
      'teliko kentro ': centerName,
      Column3: producerName,
    }
    values.push(columnNames.slice(0, 15).map((name) => Object.hasOwn(mapped, name) ? mapped[name] : null))
    rowInfos.push({ rowNumber: row.rowNumber, center: producerName })
    await onProgress({ stage: 'preparing', current: index + 1, total: rowsToExport.length, rowNumber: row.rowNumber, center: producerName })
  }
  const bodyStartRow = Number(monthRange.address?.match(/![A-Z]+(\d+):/u)?.[1])
  if (!bodyStartRow) throw new Error('Could not determine the Monthly_Settlement table row address.')
  const excelStartRow = bodyStartRow + startIndex
  const excelEndRow = excelStartRow + values.length - 1
  const targetAddress = `A${excelStartRow}:O${excelEndRow}`
  const worksheets = await graphFetch(`${workbookPath}/worksheets`, token)
  const worksheet = (worksheets.value || []).find((item) => normalizeValue(item.name) === 'MONTHLY SETTLEMENT')
  if (!worksheet) throw new Error('Excel worksheet Monthly_Settlement was not found.')
  await onProgress({ stage: 'sending', current: values.length, total: values.length, range: targetAddress })
  await writeWorksheetRows(workbookPath, worksheet.id, token, excelStartRow, 'A', 'O', values, rowInfos, onProgress)
  return { workbook: workbook.name, table: tableName, worksheet: worksheet.name, rowCount: values.length, range: targetAddress }
}

function monthlyMilkCode(value) {
  const milk = normalizeValue(value)
  if (milk.includes('BIVOL') || milk.includes('BUFF')) return 'MILK-BUFF'
  if (milk.includes('OAIE') || milk.includes('SHEEP')) return 'MILK-SHEEP'
  return 'MILK-COW'
}

function previouslySentRowNumbers(job) {
  return new Set(
    (Array.isArray(job.excelExport?.rowLog) ? job.excelExport.rowLog : [])
      .filter((row) => row.status === 'sent' && row.rowNumber !== null && row.rowNumber !== undefined)
      .map((row) => Number(row.rowNumber))
      .filter(Number.isFinite),
  )
}

async function writeWorksheetRows(workbookPath, worksheetId, token, startRow, startColumn, endColumn, values, rowInfos, onProgress, headers = {}) {
  for (let index = 0; index < values.length; index += 1) {
    const address = `${startColumn}${startRow + index}:${endColumn}${startRow + index}`
    await writeVerifiedRange(workbookPath, worksheetId, token, address, [values[index]], headers)
    await onProgress({
      stage: 'sent',
      current: index + 1,
      total: values.length,
      rowNumber: rowInfos[index]?.rowNumber,
      center: rowInfos[index]?.center,
      range: address,
    })
  }
}

async function writeVerifiedRange(workbookPath, worksheetId, token, address, values, headers = {}) {
  const rangePath = `${workbookPath}/worksheets/${encodeURIComponent(worksheetId)}/range(address='${address}')`
  try {
    await graphFetch(rangePath, token, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ values }),
    })
    return
  } catch (error) {
    if (isRetryableGraphError(error) && await rangeMatchesExpected(rangePath, token, values, headers)) return
    throw new Error(`Excel range write failed for ${address}. ${error instanceof Error ? error.message : 'Excel Online did not respond in time.'}`)
  }
}

async function rangeMatchesExpected(rangePath, token, expectedValues, headers = {}) {
  const delays = [1500, 4000, 8000]
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    await delay(delays[attempt])
    try {
      const actual = await graphFetch(rangePath, token, { headers })
      if (excelValuesMatch(actual.values || [], expectedValues)) return true
    } catch {
      // Excel Online can keep the workbook busy briefly after a timeout.
    }
  }
  return false
}

function excelValuesMatch(actualRows, expectedRows) {
  if (!Array.isArray(actualRows) || actualRows.length < expectedRows.length) return false
  return expectedRows.every((expectedRow, rowIndex) =>
    expectedRow.every((expectedValue, columnIndex) => excelValueMatches(actualRows[rowIndex]?.[columnIndex], expectedValue)),
  )
}

function excelValueMatches(actualValue, expectedValue) {
  if (expectedValue === null || expectedValue === undefined || expectedValue === '') {
    return actualValue === null || actualValue === undefined || actualValue === ''
  }
  const expectedNumber = typeof expectedValue === 'number' ? expectedValue : Number.NaN
  const actualNumber = typeof actualValue === 'number' ? actualValue : Number(String(actualValue).replace(',', '.'))
  if (Number.isFinite(expectedNumber) && Number.isFinite(actualNumber)) {
    return Math.abs(actualNumber - expectedNumber) < 0.0001
  }
  return String(actualValue ?? '').trim() === String(expectedValue ?? '').trim()
}

function findExistingDailyRouteRowIndex(rows, columnNames, mapped) {
  const indexes = columnIndexMap(columnNames)
  const expected = [
    ['Date', mapped.Date],
    ['Driver', mapped.Driver],
    ['Truck', mapped.Truck],
    ['Route_ID', mapped.Route_ID],
    ['Aviz_No', mapped.Aviz_No],
    ['Center_Name', mapped.Center_Name],
    ['Milk_Code', mapped.Milk_Code],
    ['Qty_Collected_L', mapped.Qty_Collected_L],
    ['Fat/Densitate', mapped['Fat/Densitate']],
    ['Temperature_C', mapped.Temperature_C],
  ]
  return rows.findIndex((row) => expected.every(([name, value]) => {
    const columnIndex = indexes.get(normalizeValue(name))
    return columnIndex === undefined || excelValueMatches(row?.[columnIndex], value)
  }))
}

function columnIndexMap(columnNames) {
  return new Map(columnNames.map((name, index) => [normalizeValue(name), index]))
}

function findLastUsedTableRowIndex(rows, columnNames, importantColumns) {
  const indexes = importantColumns
    .map((name) => columnNames.findIndex((columnName) => normalizeValue(columnName) === normalizeValue(name)))
    .filter((index) => index >= 0)
  if (!indexes.length) return -1
  return rows.reduce((last, row, rowIndex) =>
    indexes.some((columnIndex) => isUsedExcelValue(row?.[columnIndex])) ? rowIndex : last,
  -1)
}

function isUsedExcelValue(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

export async function matchCentersForRows(rows) {
  const centers = await loadReferenceCenters()
  return rows.map((row) => {
    const originalName = row.collectionCenter || ''
    const suggestions = centers
      .map((center) => ({ ...center, score: centerSimilarity(originalName, center.name) }))
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

export async function listReferenceProducers(query = '', kind = 'producer', headerCenterName = '') {
  const producers = await loadReferenceProducers()
  const search = String(query || '').trim()
  const centerSearch = String(headerCenterName || '').trim()
  const candidates = kind === 'center'
    ? [...new Map(producers.filter((item) => item.centerName).map((item) => [normalizeValue(item.centerName), { code: item.centerCode, name: item.centerName }])).values()]
    : producers.map((item) => ({ code: item.producerCode, name: item.producerName, centerCode: item.centerCode, centerName: item.centerName, trn: item.trn }))
  if (!search) return candidates.slice(0, 50)
  return candidates
    .map((item) => ({ ...item, score: similarity(search, item.name), headerCenterHistory: kind === 'producer' && centerSearch ? centersAreRelated(centerSearch, item.centerName) : false }))
    .filter((item) => normalizeValue(item.name).includes(normalizeValue(search)) || item.score >= 0.32)
    .sort((left, right) => (right.score + (right.headerCenterHistory ? 0.08 : 0)) - (left.score + (left.headerCenterHistory ? 0.08 : 0)) || left.name.localeCompare(right.name))
    .slice(0, 20)
    .map((item) => ({ ...item, score: Number(item.score.toFixed(3)) }))
}

export async function matchMonthlyProducers(data) {
  const producers = await loadReferenceProducers()
  const hasProducerRows = data.rows.some((row) => String(row.producer || '').trim())
  const hasCenterRows = data.rows.some((row) => String(row.centerName || '').trim())
  // Some payment-border documents contain producer rows but are labelled "overview" by OCR.
  // Normalize from the populated row fields so matching never discards extracted producer names.
  const layoutType = data.layoutType === 'overview' && hasProducerRows && !hasCenterRows ? 'detailed' : data.layoutType
  const centers = [...new Map(producers.filter((item) => item.centerName).map((item) => [normalizeValue(item.centerName), { code: item.centerCode, name: item.centerName }])).values()]
  const headerSuggestions = centers.map((item) => ({ ...item, score: similarity(data.headerCenterName, item.name) }))
    .filter((item) => item.score >= 0.32).sort((left, right) => right.score - left.score).slice(0, 5)
    .map((item) => ({ ...item, score: Number(item.score.toFixed(3)) }))
  const headerBest = headerSuggestions[0]
  const headerIdentified = headerBest?.score >= 0.6
  const header = { originalName: data.headerCenterName || null, status: headerIdentified ? 'auto_replaced' : headerSuggestions.length ? 'suggested' : 'unmatched', selectedCode: headerIdentified ? headerBest.code : null, selectedName: headerIdentified ? headerBest.name : null, suggestions: headerSuggestions }
  const headerCenterAffinity = (item) => {
    if (layoutType !== 'detailed' || !headerIdentified) return 0
    if ((headerBest.code && normalizeValue(item.centerCode) === normalizeValue(headerBest.code)) || normalizeValue(item.centerName) === normalizeValue(headerBest.name)) return 2
    return centersAreRelated(headerBest.name, item.centerName) ? 1 : 0
  }
  const rows = data.rows.map((row) => {
    const originalName = layoutType === 'detailed' ? row.producer : row.centerName
    const suggestions = producers
      .map((item) => {
        const score = similarity(originalName, item.producerName)
        const affinity = headerCenterAffinity(item)
        const historyBoost = affinity === 2 ? 0.08 : affinity === 1 ? 0.15 : 0
        return { code: item.producerCode, name: item.producerName, centerCode: item.centerCode, centerName: item.centerName, trn: item.trn, score, matchSource: affinity ? 'header_center_history' : 'all_producers', rankScore: score + historyBoost }
      })
      .filter((item) => item.score >= 0.32)
      .sort((left, right) => right.rankScore - left.rankScore)
      .slice(0, 5)
      .map(({ rankScore: _rankScore, ...item }) => ({ ...item, score: Number(item.score.toFixed(3)) }))
    const best = suggestions[0]
    const autoReplace = best?.score >= 0.6 && (best.matchSource === 'header_center_history' || best.score >= 0.75)
    return { rowNumber: row.rowNumber, originalName: originalName || null, status: autoReplace ? 'auto_replaced' : suggestions.length ? 'suggested' : 'unmatched', selectedCode: autoReplace ? best.code : null, selectedName: autoReplace ? best.name : null, suggestions, matchSource: best?.matchSource || 'all_producers' }
  })
  return { rows, header, layoutType }
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
  assertExcelOnlineConfigured(config, 'Route reference lookup')
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
  assertExcelOnlineConfigured(config, 'Previous-day reference lookup')
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
  try {
    assertExcelOnlineConfigured(config, 'Center reference lookup')
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
    centerCache = { expiresAt: Date.now() + 30 * 60 * 1000, centers }
    await saveReferenceCenterSnapshot(centers).catch(() => undefined)
    return centers
  } catch (error) {
    const cachedCenters = await loadReferenceCenterSnapshot()
    if (cachedCenters.length) {
      centerCache = { expiresAt: Date.now() + 5 * 60 * 1000, centers: cachedCenters }
      return cachedCenters
    }
    throw error
  }
}

async function loadReferenceCenterSnapshot() {
  try {
    const parsed = JSON.parse(await readFile(centerSnapshotPath, 'utf8'))
    return Array.isArray(parsed.centers)
      ? parsed.centers.map((center) => ({ code: String(center.code || '').trim(), name: String(center.name || '').trim() })).filter((center) => center.code && center.name)
      : []
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function saveReferenceCenterSnapshot(centers) {
  await mkdir(referenceCacheDir, { recursive: true })
  await writeFile(centerSnapshotPath, JSON.stringify({ updatedAt: new Date().toISOString(), centers }, null, 2), 'utf8')
}

async function loadReferenceProducers() {
  if (producerCache.expiresAt > Date.now()) return producerCache.producers
  const config = await loadConfig()
  assertExcelOnlineConfigured(config, 'Ref_Producers lookup')
  const token = await refreshAccessToken(config)
  const workbook = await resolveWorkbook(config, token)
  const workbookPath = `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`
  const worksheets = await graphFetch(`${workbookPath}/worksheets`, token)
  const worksheet = (worksheets.value || []).find((item) => item.name.toLowerCase() === 'ref_producers')
  if (!worksheet) throw new Error('Excel worksheet Ref_Producers was not found.')
  const range = await graphFetch(`${workbookPath}/worksheets/${encodeURIComponent(worksheet.id)}/usedRange(valuesOnly=true)`, token)
  const values = range.values || []
  const headerRow = values.findIndex((row) => row.some((value) => normalizeValue(value) === 'PRODUCER NAME'))
  if (headerRow < 0) throw new Error('Ref_Producers must contain a Producer_Name column.')
  const headers = values[headerRow].map(normalizeValue)
  const indexes = {
    producerCode: headers.indexOf('PRODUCER CODE'), producerName: headers.indexOf('PRODUCER NAME'), trn: headers.indexOf('TRN'),
    centerCode: headers.indexOf('CENTER CODE'), centerName: headers.indexOf('CENTER NAME'),
  }
  const producers = values.slice(headerRow + 1).map((row) => ({
    producerCode: String(row[indexes.producerCode] ?? '').trim(), producerName: String(row[indexes.producerName] ?? '').trim(),
    centerCode: String(row[indexes.centerCode] ?? '').trim(), centerName: String(row[indexes.centerName] ?? '').trim(), trn: String(row[indexes.trn] ?? '').trim(),
  })).filter((item) => item.producerName)
  producerCache = { expiresAt: Date.now() + DRIVER_CACHE_MS, producers }
  return producers
}

async function loadReferenceDrivers() {
  if (driverCache.expiresAt > Date.now()) return driverCache.drivers
  const config = await loadConfig()
  assertExcelOnlineConfigured(config, 'Driver reference lookup')
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
  assertExcelOnlineConfigured(config, 'Vehicle reference lookup')
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
  assertExcelOnlineConfigured(config, 'Vehicle route reference lookup')
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

function centersAreRelated(leftValue, rightValue) {
  const left = normalizeValue(leftValue)
  const right = normalizeValue(rightValue)
  if (!left || !right) return false
  if (similarity(left, right) >= 0.6) return true
  const leftFamily = left.replace(/\s+\d+$/u, '')
  const rightFamily = right.replace(/\s+\d+$/u, '')
  return Boolean(leftFamily && rightFamily && leftFamily === rightFamily)
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

function centerSimilarity(leftValue, rightValue) {
  const left = normalizeValue(leftValue)
  const right = normalizeValue(rightValue)
  const compactLeft = left.replace(/\s+/gu, '')
  const compactRight = right.replace(/\s+/gu, '')
  const baseScore = similarity(left, right)
  if (!left || !right) return baseScore
  if (right.startsWith(left)) return Math.max(baseScore, 0.96)
  if (right.split(' ').some((token) => token.startsWith(left))) return Math.max(baseScore, 0.92)
  if (right.includes(left)) return Math.max(baseScore, 0.82)
  if (compactRight.startsWith(compactLeft)) return Math.max(baseScore, 0.96)
  if (compactRight.includes(compactLeft)) return Math.max(baseScore, 0.82)
  return baseScore
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

export async function refreshAccessToken(config) {
  if (!tokenRefreshPromise) {
    tokenRefreshPromise = performTokenRefresh(config).finally(() => { tokenRefreshPromise = null })
  }
  return tokenRefreshPromise
}

async function performTokenRefresh(config) {
  let cached
  try {
    cached = JSON.parse(await readFile(config.tokenCachePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Excel Online token cache was not found on this PC. Set EXCEL_GRAPH_TOKEN_CACHE in .env and sign in to the Excel integration before using Excel reference matching or export.')
    }
    throw error
  }
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

export async function resolveWorkbook(config, token) {
  if (config.driveId && config.itemId) return { driveId: config.driveId, itemId: config.itemId, name: config.itemId }
  const base64 = Buffer.from(config.workbookUrl, 'utf8').toString('base64')
  const shareId = `u!${base64.replace(/=+$/u, '').replace(/\//gu, '_').replace(/\+/gu, '-')}`
  const item = await graphFetch(`/shares/${shareId}/driveItem`, token, { headers: { Prefer: 'redeemSharingLinkIfNecessary' } })
  if (!item.parentReference?.driveId || !item.id) throw new Error('Could not resolve the Excel Online workbook.')
  return { driveId: item.parentReference.driveId, itemId: item.id, name: item.name }
}

export async function graphFetch(pathname, token, options = {}) {
  const { retryable: retryableOverride, timeoutMs = 45000, ...fetchOptions } = options
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', ...fetchOptions.headers }
  if (fetchOptions.body) headers['Content-Type'] = 'application/json'
  const method = fetchOptions.method || 'GET'
  const retryable = retryableOverride ?? (method === 'GET' || method === 'PATCH')
  const maxAttempts = retryable ? 3 : 1
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`${GRAPH_ROOT}${pathname}`, { ...fetchOptions, headers }, timeoutMs)
      return await parseResponse(response, `${method} ${pathname}`)
    } catch (error) {
      lastError = enrichFetchError(error, `${method} ${pathname}`)
      if (!retryable || attempt === maxAttempts || !isRetryableGraphError(lastError)) throw lastError
      await delay(graphRetryDelayMs(error, attempt))
    }
  }
  throw lastError
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const upstreamSignal = options.signal
  const onAbort = () => controller.abort(upstreamSignal.reason)
  if (upstreamSignal?.aborted) controller.abort(upstreamSignal.reason)
  upstreamSignal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => {
    const error = new Error(`Graph request timed out after ${Math.round(timeoutMs / 1000)} seconds`)
    error.code = 'ETIMEDOUT'
    controller.abort(error)
  }, timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason
    throw error
  } finally {
    clearTimeout(timeout)
    upstreamSignal?.removeEventListener('abort', onAbort)
  }
}

function enrichFetchError(error, context) {
  if (!(error instanceof Error)) return new Error(`${context} failed: network request failed.`)
  if (error.code === 'ETIMEDOUT') {
    const enriched = new Error(`${context} failed: ${error.message}.`)
    enriched.code = error.code
    return enriched
  }
  if (error.message !== 'fetch failed') return error
  const cause = error.cause
  const detail = [cause?.code, cause?.message].filter(Boolean).join(' - ')
  const enriched = new Error(`${context} failed: fetch failed${detail ? ` (${detail})` : ''}.`)
  enriched.status = error.status
  enriched.retryAfter = error.retryAfter
  enriched.cause = cause
  return enriched
}

async function parseResponse(response, context) {
  const text = await response.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = { message: text } }
  }
  if (!response.ok) {
    const detail = body?.error?.message || body?.error_description || body?.message || response.statusText
    const error = new Error(`${context} failed (${response.status})${detail ? `: ${detail}` : '.'}`)
    error.status = response.status
    error.retryAfter = response.headers.get('retry-after')
    throw error
  }
  return body || {}
}

function isRetryableGraphError(error) {
  const status = Number(error?.status)
  const networkCode = error?.code || error?.cause?.code
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
    || ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'].includes(networkCode)
}

function graphRetryDelayMs(error, attempt) {
  const retryAfterSeconds = Number(error?.retryAfter)
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return Math.min(retryAfterSeconds * 1000, 15000)
  return attempt * 2500
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
