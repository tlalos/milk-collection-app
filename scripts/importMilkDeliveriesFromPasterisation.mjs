import 'dotenv/config'
import os from 'node:os'
import sql from 'mssql'
import { loadConfig, refreshAccessToken, resolveWorkbook, graphFetch } from '../server/excelService.js'
import { deliveryNaturalKey, mapPasterisationDeliveries } from '../server/milkDeliveryImport.js'

const workbookName = 'pasterisation.xlsx'
const sheetName = 'Milk Deliveries'
const apply = process.argv.includes('--apply')
if (process.argv.slice(2).some((arg) => arg !== '--apply')) throw new Error('Use --apply to import, or no arguments for a dry run.')

async function readWorkbookRows() {
  const config = await loadConfig()
  const token = await refreshAccessToken(config)
  const connected = await resolveWorkbook(config, token)
  const search = await graphFetch(`/drives/${encodeURIComponent(connected.driveId)}/root/search(q=%27pasterisation.xlsx%27)`, token)
  const matches = (search.value || []).filter((item) => item.name?.toLowerCase() === workbookName)
  if (matches.length !== 1) throw new Error(`Expected one ${workbookName} in the connected SharePoint drive; found ${matches.length}.`)
  const workbookPath = `/drives/${encodeURIComponent(connected.driveId)}/items/${encodeURIComponent(matches[0].id)}/workbook`
  const worksheets = await graphFetch(`${workbookPath}/worksheets`, token)
  const sheets = (worksheets.value || []).filter((sheet) => sheet.name === sheetName)
  if (sheets.length !== 1) throw new Error(`Expected one ${sheetName} worksheet; found ${sheets.length}.`)
  const sheetPath = `${workbookPath}/worksheets/${encodeURIComponent(sheets[0].id)}`
  const usedRange = await graphFetch(`${sheetPath}/usedRange(valuesOnly=true)?%24select=address,rowCount,columnCount`, token)
  if (usedRange.columnCount !== 16 || usedRange.rowCount < 2 || usedRange.rowCount > 10_000) {
    throw new Error(`Unexpected worksheet size: ${usedRange.rowCount} rows and ${usedRange.columnCount} columns.`)
  }
  const values = []
  for (let start = 1; start <= usedRange.rowCount; start += 250) {
    const end = Math.min(start + 249, usedRange.rowCount)
    const range = await graphFetch(`${sheetPath}/range(address=%27A${start}:P${end}%27)`, token)
    values.push(...range.values)
  }
  return { workbook: matches[0].name, sheet: sheets[0].name, ...mapPasterisationDeliveries(values) }
}

function sqlConfig() {
  const user = process.env.SQL_USER || process.env.MSSQL_USER
  const password = process.env.SQL_PASSWORD || process.env.MSSQL_PASSWORD
  if (!user || !password) throw new Error('SQL_USER and SQL_PASSWORD are required.')
  return {
    server: process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost',
    database: process.env.SQL_DATABASE || process.env.MSSQL_DATABASE || 'milkcollection',
    user,
    password,
    options: {
      encrypt: String(process.env.SQL_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: String(process.env.SQL_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false',
    },
  }
}

async function existingDeliveries(request) {
  const result = await request.query(`
SELECT deliveryId, CONVERT(varchar(10), deliveryDate, 23) AS deliveryDate, truckNumber, aviz,
       milkType, loadedWeightKg, emptyWeightKg
FROM dbo.MilkDeliveries;
`)
  return result.recordset
}

function pendingRows(sourceRows, existing) {
  const ids = new Set(existing.map((row) => row.deliveryId))
  const keys = new Set(existing.map(deliveryNaturalKey))
  const pending = []
  const skippedIds = []
  const skippedMatches = []
  for (const row of sourceRows) {
    if (ids.has(row.deliveryId)) skippedIds.push(row.excelRowNumber)
    else if (keys.has(deliveryNaturalKey(row))) skippedMatches.push(row.excelRowNumber)
    else pending.push(row)
  }
  return { pending, skippedIds, skippedMatches }
}

async function insertDelivery(transaction, row, now) {
  const request = new sql.Request(transaction)
  request
    .input('deliveryId', sql.NVarChar(120), row.deliveryId)
    .input('deliveryDate', sql.Date, row.deliveryDate)
    .input('deliveryTime', sql.NVarChar(8), row.deliveryTime || null)
    .input('truckNumber', sql.NVarChar(80), row.truckNumber || null)
    .input('tractorNumber', sql.NVarChar(80), row.tractorNumber || null)
    .input('aviz', sql.NVarChar(120), row.aviz || null)
    .input('milkType', sql.NVarChar(60), row.milkType)
    .input('milkTypeLabel', sql.NVarChar(160), row.milkTypeLabel)
    .input('densityFactor', sql.Decimal(18, 6), row.densityFactor)
    .input('loadedWeightKg', sql.Decimal(18, 3), row.loadedWeightKg)
    .input('emptyWeightKg', sql.Decimal(18, 3), row.emptyWeightKg)
    .input('netQuantityKg', sql.Decimal(18, 3), row.netQuantityKg)
    .input('calculatedLiters', sql.Decimal(18, 3), row.calculatedLiters)
    .input('deliveryCategory', sql.NVarChar(40), row.deliveryCategory)
    .input('departureComments', sql.NVarChar(1200), row.departureComments || null)
    .input('greeceWeight', sql.Decimal(18, 3), row.greeceWeight)
    .input('invoiceNumber', sql.NVarChar(160), row.invoiceNumber || null)
    .input('differenceAmount', sql.Decimal(18, 3), row.differenceAmount)
    .input('arrivalComments', sql.NVarChar(1200), row.arrivalComments || null)
    .input('status', sql.NVarChar(40), row.status)
    .input('now', sql.DateTimeOffset, now)
  await request.query(`
INSERT INTO dbo.MilkDeliveries (
  deliveryId, deliveryDate, deliveryTime, truckNumber, tractorNumber, aviz, milkType, milkTypeLabel, densityFactor,
  loadedWeightKg, loadedWeighedAt, emptyWeightKg, emptyWeighedAt, netQuantityKg, calculatedLiters,
  deliveryCategory, departureComments, greeceWeight, invoiceNumber, differenceAmount, arrivalComments, status,
  createdAt, updatedAt, createdBy, updatedBy
) VALUES (
  @deliveryId, @deliveryDate, CONVERT(time(0), @deliveryTime), @truckNumber, @tractorNumber, @aviz, @milkType, @milkTypeLabel, @densityFactor,
  @loadedWeightKg, NULL, @emptyWeightKg, NULL, @netQuantityKg, @calculatedLiters,
  @deliveryCategory, @departureComments, @greeceWeight, @invoiceNumber, @differenceAmount, @arrivalComments, @status,
  @now, @now, N'excel-import', N'excel-import'
);
`)
}

const source = await readWorkbookRows()
const pool = await new sql.ConnectionPool(sqlConfig()).connect()
try {
  const identity = await pool.request().query("SELECT DB_NAME() AS databaseName, CAST(SERVERPROPERTY('MachineName') AS nvarchar(128)) AS machineName;")
  const { databaseName, machineName } = identity.recordset[0]
  if (machineName.toLowerCase() !== os.hostname().toLowerCase()) {
    throw new Error(`Import requires a local SQL server. Connected to ${machineName}, but this PC is ${os.hostname()}.`)
  }
  const existing = await existingDeliveries(pool.request())
  const preview = pendingRows(source.rows, existing)
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    workbook: source.workbook,
    sheet: source.sheet,
    localDatabase: databaseName,
    sourceRows: source.rows.length,
    existingDatabaseRows: existing.length,
    pendingRows: preview.pending.length,
    skippedImportedIds: preview.skippedIds.length,
    skippedMatchingDeliveries: preview.skippedMatches,
    pendingStatuses: Object.fromEntries(['DRAFT', 'AWAITING_GREECE', 'COMPLETE'].map((status) => [status, preview.pending.filter((row) => row.status === status).length])),
    warnings: source.warnings,
  }
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    const transaction = new sql.Transaction(pool)
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    let inserted = 0
    try {
      const current = await existingDeliveries(new sql.Request(transaction))
      const ready = pendingRows(source.rows, current)
      const now = new Date()
      for (const row of ready.pending) {
        await insertDelivery(transaction, row, now)
        inserted += 1
      }
      await transaction.commit()
      console.log(JSON.stringify({ ...summary, inserted }, null, 2))
    } catch (error) {
      await transaction.rollback()
      throw error
    }
  }
} finally {
  await pool.close()
}
