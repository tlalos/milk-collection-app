import 'dotenv/config'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sql from 'mssql'

export const MONTH = '2026-08'
const table = 'dbo.MonthlyProducerPricing'
const fields = ['monthKey', 'producerCode', 'milkType', 'responsiblePrice', 'producerName', 'centerCode', 'centerName']
const codeKey = row => `${row.producerCode.trim().toLowerCase()}|${row.milkType.trim().toUpperCase()}`
const checksum = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex')
const stamp = () => new Date().toISOString().replaceAll(/[-:]/gu, '').replace(/\..+$/u, '').replace('T', '-')

function priceUnits(value) {
  const match = /^(\d{1,7})(?:\.(\d{1,4}))?$/u.exec(String(value))
  if (!match || Number(value) > 1000000) throw new Error(`Invalid base milk price: ${value}`)
  return BigInt(match[1]) * 10000n + BigInt((match[2] || '').padEnd(4, '0'))
}

export function validateRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('No August prices in snapshot.')
  const seen = new Set()
  for (const row of rows) {
    if (!row || Object.keys(row).some(key => !fields.includes(key))) throw new Error('Unexpected snapshot fields; only base prices are supported.')
    if (row.monthKey !== MONTH) throw new Error('Only August 2026 is allowed.')
    if (typeof row.producerCode !== 'string' || !/^p[^\s|]+$/iu.test(row.producerCode) || row.producerCode.length > 80) throw new Error('Invalid producer code.')
    if (!['MILK-COW', 'MILK-SHEEP', 'MILK-GOAT', 'MILK-BUFF'].includes(row.milkType)) throw new Error('Invalid milk type.')
    priceUnits(row.responsiblePrice)
    for (const [field, limit] of [['producerName', 240], ['centerCode', 80], ['centerName', 240]]) {
      if (row[field] != null && (typeof row[field] !== 'string' || row[field].length > limit)) throw new Error(`Invalid ${field}.`)
    }
    const key = codeKey(row)
    if (seen.has(key)) throw new Error(`Duplicate August price: ${key}`)
    seen.add(key)
  }
}

export function validateSnapshot(snapshot) {
  if (snapshot.formatVersion !== 1 || snapshot.sourceTable !== table || snapshot.month !== MONTH || snapshot.fields?.join(',') !== 'responsiblePrice' ||
    snapshot.rowCount !== snapshot.rows?.length || snapshot.checksum !== checksum(snapshot.rows) ||
    !snapshot.source?.serverName || !snapshot.source?.databaseName) throw new Error('Invalid or changed August price snapshot.')
  validateRows(snapshot.rows)
}

export function planImport(rows, existing, invoices, replaceExisting = false) {
  validateRows(rows)
  const byKey = new Map(existing.filter(row => row.monthKey === MONTH).map(row => [codeKey(row), row]))
  const plan = { insert: [], update: [], unchanged: [], conflicts: [] }
  for (const row of rows) {
    const current = byKey.get(codeKey(row))
    if (current?.responsiblePrice != null && priceUnits(current.responsiblePrice) === priceUnits(row.responsiblePrice)) {
      plan.unchanged.push(codeKey(row))
      continue
    }
    const locked = invoices.some(invoice => invoice.monthKey === MONTH && invoice.producerCode.trim().toLowerCase() === row.producerCode.toLowerCase() &&
      (!invoice.milkType?.trim() || invoice.milkType.trim().toUpperCase() === row.milkType) && invoice.status !== 'DRAFT')
    if (locked) plan.conflicts.push({ key: codeKey(row), reason: 'Invoice is sent, sending, unconfirmed or otherwise locked.' })
    else if (current?.responsiblePrice != null && !replaceExisting) plan.conflicts.push({ key: codeKey(row), reason: 'A different August price already exists.', current: current.responsiblePrice, incoming: row.responsiblePrice })
    else (current ? plan.update : plan.insert).push(row)
  }
  return plan
}

function sqlConfig() {
  const port = process.env.SQL_PORT || process.env.MSSQL_PORT
  const user = process.env.SQL_USER || process.env.MSSQL_USER
  const password = process.env.SQL_PASSWORD || process.env.MSSQL_PASSWORD
  if (!user || !password) throw new Error('Run from the application folder with SQL_USER and SQL_PASSWORD configured in .env.')
  return {
    server: process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost',
    database: process.env.SQL_DATABASE || process.env.MSSQL_DATABASE || 'milkcollection',
    user, password, ...(port ? { port: Number(port) } : {}),
    options: {
      encrypt: String(process.env.SQL_ENCRYPT || process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: String(process.env.SQL_TRUST_SERVER_CERTIFICATE || process.env.MSSQL_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false',
    },
  }
}

async function identity(pool) {
  const result = await pool.request().query("SELECT CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS serverName, DB_NAME() AS databaseName;")
  return result.recordset[0]
}

async function pricingRows(request, lock = false) {
  return (await request.query(`SELECT *, CONVERT(varchar(40), responsiblePrice) AS exactPrice
    FROM dbo.MonthlyProducerPricing ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
    WHERE monthKey = '2026-08' ORDER BY producerCode, milkType;`)).recordset
    .map(({ exactPrice, ...row }) => ({ ...row, responsiblePrice: exactPrice }))
}

async function invoiceRows(request, lock = false) {
  return (await request.query(`SELECT monthKey, producerCode, milkType, status FROM dbo.MonthlyInvoices ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
    WHERE monthKey = '2026-08';`)).recordset
}

async function exportPrices(directory) {
  const pool = await new sql.ConnectionPool(sqlConfig()).connect()
  try {
    const source = await identity(pool)
    const all = await pricingRows(pool.request())
    const rows = all.filter(row => row.responsiblePrice != null).map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null])))
    validateRows(rows)
    const snapshot = { formatVersion: 1, sourceTable: table, source, month: MONTH, fields: ['responsiblePrice'], exportedAt: new Date().toISOString(), rowCount: rows.length, checksum: checksum(rows), rows }
    const output = path.resolve(directory || path.join('work', `august-prices-${stamp()}`))
    await mkdir(output, { recursive: true })
    await writeFile(path.join(output, 'august-prices.json'), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' })
    console.log(JSON.stringify({ output, month: MONTH, rows: rows.length, omittedMissingPrices: all.length - rows.length, source, checksum: snapshot.checksum }, null, 2))
  } finally { await pool.close() }
}

// The fixed month is enforced independently in every write, not only by the file validator.
export const updateSql = `UPDATE dbo.MonthlyProducerPricing
 SET responsiblePrice = @price, pricingStatus = N'SAVED', lastSaved = SYSDATETIMEOFFSET(), updatedAt = SYSDATETIMEOFFSET()
 WHERE monthKey = '2026-08' AND producerCode = @producerCode AND milkType = @milkType;`
export const insertSql = `INSERT INTO dbo.MonthlyProducerPricing
 (monthKey, producerCode, milkType, responsiblePrice, producerName, centerCode, centerName, pricingStatus, lastSaved)
 VALUES ('2026-08', @producerCode, @milkType, @price, @producerName, @centerCode, @centerName, N'SAVED', SYSDATETIMEOFFSET());`

async function writeRow(tx, row, insert) {
  const request = new sql.Request(tx)
    .input('producerCode', sql.NVarChar(80), row.producerCode)
    .input('milkType', sql.NVarChar(40), row.milkType)
    .input('price', sql.Decimal(18, 4), Number(row.responsiblePrice))
  if (insert) request.input('producerName', sql.NVarChar(240), row.producerName ?? null)
    .input('centerCode', sql.NVarChar(80), row.centerCode ?? null).input('centerName', sql.NVarChar(240), row.centerName ?? null)
  const result = await request.query(insert ? insertSql : updateSql)
  if (result.rowsAffected[0] !== 1) throw new Error('Unexpected number of changed prices; rolling back.')
}

async function importPrices(file, { apply, replaceExisting, confirmTarget }) {
  const snapshot = JSON.parse(await readFile(path.resolve(file), 'utf8'))
  validateSnapshot(snapshot)
  const pool = await new sql.ConnectionPool(sqlConfig()).connect()
  let tx
  try {
    const target = await identity(pool)
    const targetLabel = `${target.serverName}/${target.databaseName}`
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', month: MONTH, target, confirmTarget: targetLabel, fields: snapshot.fields }, null, 2))
    if (apply && targetLabel.toLowerCase() === `${snapshot.source.serverName}/${snapshot.source.databaseName}`.toLowerCase()) throw new Error('Target is the source database; refusing to apply.')
    if (apply && confirmTarget !== targetLabel) throw new Error('Use --confirm-target with the exact confirmTarget printed by the dry run.')
    if (apply) {
      tx = new sql.Transaction(pool)
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    }
    const request = () => tx ? new sql.Request(tx) : pool.request()
    // Lock invoice state before planning price changes.
    const invoices = await invoiceRows(request(), apply)
    const current = await pricingRows(request(), apply)
    const plan = planImport(snapshot.rows, current, invoices, replaceExisting)
    console.log(JSON.stringify({ wouldInsert: plan.insert.length, wouldUpdate: plan.update.length, unchanged: plan.unchanged.length, conflicts: plan.conflicts,
      changes: [...plan.insert, ...plan.update].map(row => ({ producerCode: row.producerCode, milkType: row.milkType, newPrice: row.responsiblePrice,
        previousPrice: current.find(item => codeKey(item) === codeKey(row))?.responsiblePrice ?? null })) }, null, 2))
    if (plan.conflicts.length) throw new Error('Conflicts found. Nothing was imported. Resolve them before applying; --replace-existing only permits different, unlocked August prices.')
    if (!apply) return
    const backupPath = path.join(path.dirname(path.resolve(file)), `august-prices-before-${stamp()}.json`)
    await writeFile(backupPath, `${JSON.stringify({ target, month: MONTH, backedUpAt: new Date().toISOString(), rows: current, plannedInserts: plan.insert, plannedUpdates: plan.update }, null, 2)}\n`, { flag: 'wx' })
    for (const row of plan.update) await writeRow(tx, row, false)
    for (const row of plan.insert) await writeRow(tx, row, true)
    const after = planImport(snapshot.rows, await pricingRows(new sql.Request(tx), true), invoices)
    if (after.insert.length || after.update.length || after.conflicts.length) throw new Error('Post-import verification failed; rolling back.')
    await tx.commit()
    tx = null
    console.log(JSON.stringify({ applied: true, inserted: plan.insert.length, updated: plan.update.length, unchanged: plan.unchanged.length, backupPath, month: MONTH }, null, 2))
  } catch (error) {
    if (tx) await tx.rollback().catch(() => undefined)
    throw error
  } finally { await pool.close() }
}

export async function main(args) {
  const [command, file, ...flags] = args
  if (command === 'export' && !flags.length) return exportPrices(file)
  if (command === 'import' && file) {
    const options = { apply: false, replaceExisting: false, confirmTarget: '' }
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === '--apply') options.apply = true
      else if (flags[i] === '--replace-existing') options.replaceExisting = true
      else if (flags[i] === '--confirm-target' && flags[i + 1]) options.confirmTarget = flags[++i]
      else throw new Error(`Unknown or incomplete option: ${flags[i]}`)
    }
    return importPrices(file, options)
  }
  throw new Error('Usage: node scripts/transferAugustPrices.mjs export [directory] OR import <august-prices.json> [--replace-existing] [--apply --confirm-target "SERVER/DATABASE"]')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
