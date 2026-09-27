import 'dotenv/config'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sql from 'mssql'
import { deliveryColumns, planMilkDeliveryImport, validateMilkDeliverySnapshot } from '../server/milkDeliveryTransfer.js'

const snapshotName = 'milk-deliveries.json'
const selectedColumns = deliveryColumns.map((column) => {
  if (column === 'deliveryDate') return 'CONVERT(varchar(10), deliveryDate, 23) AS deliveryDate'
  if (column === 'deliveryTime') return 'CONVERT(varchar(8), deliveryTime, 108) AS deliveryTime'
  return `[${column}]`
}).join(', ')

function sqlConfig() {
  const portValue = process.env.SQL_PORT || process.env.MSSQL_PORT
  const user = process.env.SQL_USER || process.env.MSSQL_USER
  const password = process.env.SQL_PASSWORD || process.env.MSSQL_PASSWORD
  if (!user || !password) throw new Error('SQL_USER and SQL_PASSWORD must be configured in .env.')
  return {
    server: process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost',
    ...(portValue ? { port: Number(portValue) } : {}),
    database: process.env.SQL_DATABASE || process.env.MSSQL_DATABASE || 'milkcollection',
    user,
    password,
    options: {
      encrypt: String(process.env.SQL_ENCRYPT || process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: String(process.env.SQL_TRUST_SERVER_CERTIFICATE || process.env.MSSQL_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false',
    },
  }
}

async function identity(pool) {
  const result = await pool.request().query("SELECT CAST(SERVERPROPERTY('MachineName') AS nvarchar(128)) AS serverName, DB_NAME() AS databaseName;")
  return result.recordset[0]
}

async function deliveryRows(request, lock = false) {
  const result = await request.query(`SELECT ${selectedColumns} FROM dbo.MilkDeliveries ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''} ORDER BY deliveryId;`)
  return result.recordset
}

function checksum(rows) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

function timestamp() {
  const date = new Date()
  return date.toISOString().replaceAll(/[-:]/gu, '').replace(/\..+$/u, '').replace('T', '-')
}

async function exportSnapshot(outputDir) {
  const pool = await new sql.ConnectionPool(sqlConfig()).connect()
  try {
    const source = await identity(pool)
    const rows = await deliveryRows(pool.request())
    validateMilkDeliverySnapshot(rows)
    const snapshot = {
      formatVersion: 1,
      sourceTable: 'dbo.MilkDeliveries',
      source,
      exportedAt: new Date().toISOString(),
      rowCount: rows.length,
      checksum: checksum(rows),
      rows,
    }
    const directory = path.resolve(outputDir || path.join('work', `milk-deliveries-data-${timestamp()}`))
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, snapshotName), `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await writeFile(path.join(directory, 'README.txt'), [
      'Milk Deliveries SQL data import',
      '',
      `Source: ${source.serverName} / ${source.databaseName}`,
      `Rows: ${rows.length}`,
      '',
      'Keep this data package private and extract it outside the IIS website folder.',
      'Deploy the application ZIP and restart the IIS app before importing, so the table exists.',
      '',
      'In PowerShell on the production server:',
      '  cd C:\\inetpub\\wwwroot\\milk',
      '  node .\\scripts\\transferMilkDeliveries.mjs import "C:\\temp\\milk-deliveries-data\\milk-deliveries.json"',
      '  Check the target server/database, insert count, and conflicts in the dry-run output.',
      '  Only when those are correct, run:',
      '  node .\\scripts\\transferMilkDeliveries.mjs import "C:\\temp\\milk-deliveries-data\\milk-deliveries.json" --apply',
      '  Run the dry-run command again; it should report zero rows to insert.',
      '',
      'Adjust the snapshot path to where you extracted this package.',
      'Existing deliveries are never updated or deleted. Conflicts stop the entire import.',
      'The application activity log is not transferred with these data rows.',
      '',
    ].join('\r\n'), { encoding: 'utf8', flag: 'wx' })
    console.log(JSON.stringify({ directory, source, rows: rows.length, checksum: snapshot.checksum }, null, 2))
  } finally {
    await pool.close()
  }
}

const stringTypes = {
  deliveryId: 120, truckNumber: 80, tractorNumber: 80, aviz: 120,
  milkType: 60, milkTypeLabel: 160, deliveryCategory: 40,
  departureComments: 1200, invoiceNumber: 160, arrivalComments: 1200,
  status: 40, createdBy: 160, updatedBy: 160,
}
const decimalFields = new Set([
  'loadedWeightKg', 'emptyWeightKg', 'netQuantityKg', 'calculatedLiters',
  'greeceFullWeightKg', 'greeceEmptyWeightKg', 'greeceWeight', 'differenceAmount',
])
const dateTimeFields = new Set(['loadedWeighedAt', 'emptyWeighedAt'])

function bindValue(request, column, value) {
  if (column === 'deliveryDate') return request.input(column, sql.Date, value)
  if (column === 'deliveryTime') return request.input(column, sql.NVarChar(8), value || null)
  if (column === 'densityFactor') return request.input(column, sql.Decimal(18, 6), value)
  if (decimalFields.has(column)) return request.input(column, sql.Decimal(18, 3), value)
  if (dateTimeFields.has(column)) return request.input(column, sql.DateTime2, value ? new Date(value) : null)
  if (column === 'createdAt' || column === 'updatedAt') return request.input(column, sql.DateTimeOffset, new Date(value))
  return request.input(column, sql.NVarChar(stringTypes[column]), value)
}

async function insertDelivery(transaction, row) {
  const request = new sql.Request(transaction)
  for (const column of deliveryColumns) bindValue(request, column, row[column])
  const columns = deliveryColumns.map((column) => `[${column}]`).join(', ')
  const values = deliveryColumns.map((column) => column === 'deliveryTime' ? 'CONVERT(time(0), @deliveryTime)' : `@${column}`).join(', ')
  await request.query(`INSERT INTO dbo.MilkDeliveries (${columns}) VALUES (${values});`)
}

async function importSnapshot(filePath, apply) {
  const snapshot = JSON.parse(await readFile(path.resolve(filePath), 'utf8'))
  if (snapshot.formatVersion !== 1 || snapshot.sourceTable !== 'dbo.MilkDeliveries' ||
    snapshot.rowCount !== snapshot.rows?.length || snapshot.checksum !== checksum(snapshot.rows)) {
    throw new Error('Invalid or changed Milk Deliveries snapshot. Do not import it.')
  }
  validateMilkDeliverySnapshot(snapshot.rows)
  const pool = await new sql.ConnectionPool(sqlConfig()).connect()
  try {
    const target = await identity(pool)
    const table = await pool.request().query("SELECT OBJECT_ID(N'dbo.MilkDeliveries', N'U') AS tableId;")
    if (!table.recordset[0]?.tableId) throw new Error('dbo.MilkDeliveries does not exist. Deploy and restart the app first.')
    if (apply && target.serverName === snapshot.source?.serverName && target.databaseName === snapshot.source?.databaseName) {
      throw new Error('The target is the same database as the snapshot source; refusing to apply.')
    }
    const existing = await deliveryRows(pool.request())
    const preview = planMilkDeliveryImport(snapshot.rows, existing)
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', target, snapshotRows: snapshot.rows.length,
      existingRows: existing.length, wouldInsert: preview.insert.length, unchanged: preview.unchanged.length,
      conflicts: preview.conflicts }, null, 2))
    if (preview.conflicts.length) throw new Error('Production has conflicting deliveries. No rows were imported.')
    if (!apply) return

    const transaction = new sql.Transaction(pool)
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    try {
      const current = await deliveryRows(new sql.Request(transaction), true)
      const plan = planMilkDeliveryImport(snapshot.rows, current)
      if (plan.conflicts.length) throw new Error('Production changed during import. No rows were imported.')
      for (const row of plan.insert) await insertDelivery(transaction, row)
      await transaction.commit()
      console.log(JSON.stringify({ imported: plan.insert.length, unchanged: plan.unchanged.length, target }, null, 2))
    } catch (error) {
      await transaction.rollback()
      throw error
    }
  } finally {
    await pool.close()
  }
}

const [command, argument, ...options] = process.argv.slice(2)
if (command === 'export' && options.length === 0) await exportSnapshot(argument)
else if (command === 'import' && argument && (options.length === 0 || (options.length === 1 && options[0] === '--apply'))) {
  await importSnapshot(argument, options[0] === '--apply')
} else {
  throw new Error('Usage: node scripts/transferMilkDeliveries.mjs export [output-directory] OR import <snapshot-file> [--apply]')
}
