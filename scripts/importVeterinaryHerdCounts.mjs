import 'dotenv/config'
import ExcelJS from 'exceljs'
import sql from 'mssql'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { approvedSourceHash, readVeterinaryHerdRows, planVeterinaryHerdImport } from './prepareVeterinaryImport.mjs'
import { getProducerContractPool, closeProducerContractStore } from '../server/producerContractStore.js'
import { producerHerdSchemaSql, selectProducerHerdCountsSql, planProducerHerdCounts, insertProducerHerdCount } from '../server/producerHerdStore.js'

export async function main(args) {
  const [file, ...flags] = args
  let apply = false
  let confirmTarget = ''
  let effectiveMonth = ''
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--apply') apply = true
    else if (flags[i] === '--confirm-target' && flags[i + 1]) confirmTarget = flags[++i]
    else if (flags[i] === '--effective-month' && flags[i + 1]) effectiveMonth = flags[++i]
    else throw new Error(`Unknown or incomplete option: ${flags[i]}`)
  }
  if (!file || !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(effectiveMonth)) throw new Error('Usage: node scripts/importVeterinaryHerdCounts.mjs <workbook.xlsx> --effective-month YYYY-MM [--apply --confirm-target "SERVER/DATABASE"]')
  const bytes = await readFile(path.resolve(file))
  const source = { file: path.basename(file), sheet: 'formular 1', sha256: createHash('sha256').update(bytes).digest('hex') }
  if (source.sha256 !== approvedSourceHash) throw new Error('Workbook differs from the source reviewed by the user. Review the matching decisions first.')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  const sourceRows = readVeterinaryHerdRows(workbook)
  let transaction
  try {
    const pool = await getProducerContractPool()
    const target = (await pool.request().query("SELECT CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS serverName, DB_NAME() AS databaseName;")).recordset[0]
    const label = `${target.serverName}/${target.databaseName}`
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', target: label, effectiveMonth, source }))
    if (apply && confirmTarget !== label) throw new Error('Use the exact --confirm-target from the dry run.')
    if (apply) {
      transaction = new sql.Transaction(pool)
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    }
    const request = () => transaction ? new sql.Request(transaction) : pool.request()
    const snapshot = (await request().query("SELECT producersJson FROM dbo.OcrErpReferenceSnapshot WHERE snapshotKey=N'suppliers';")).recordset[0]
    if (!snapshot) throw new Error('No saved ERP producer list.')
    const matches = planVeterinaryHerdImport(sourceRows, JSON.parse(snapshot.producersJson), [])
    if (matches.conflicts.length) {
      console.log(JSON.stringify({ conflicts: matches.conflicts }))
      throw new Error('Matching conflicts found. Nothing imported.')
    }
    const rows = matches.ready.map(row => ({ producerCode: row.producerCode, cowCount: row.cowCount, buffaloCount: null, sheepGoatCount: null, sourceRows: row.sourceRows, effectiveMonth }))
    const exists = (await request().query("SELECT OBJECT_ID(N'dbo.ProducerHerdCounts', N'U') AS tableId;")).recordset[0].tableId
    const existing = exists ? (await request().query(`${selectProducerHerdCountsSql}${apply ? ' WITH (UPDLOCK,HOLDLOCK)' : ''};`)).recordset : []
    const plan = planProducerHerdCounts(rows, existing)
    console.log(JSON.stringify({ wouldInsert: plan.insert.length, unchanged: plan.unchanged.length, cows: rows.reduce((sum, row) => sum + row.cowCount, 0), skipped: matches.skipped.length, merged: matches.merged.length, conflicts: plan.conflicts }))
    if (plan.conflicts.length) throw new Error('Existing data conflicts. Nothing imported.')
    if (!apply) return
    await request().batch(producerHerdSchemaSql)
    for (const row of plan.insert) await insertProducerHerdCount(transaction, row, source)
    const after = (await request().query(`${selectProducerHerdCountsSql};`)).recordset
    const verified = planProducerHerdCounts(rows, after)
    if (verified.insert.length || verified.conflicts.length || verified.unchanged.length !== rows.length) throw new Error('Import verification failed. Rolling back.')
    await transaction.commit()
    transaction = null
    console.log(JSON.stringify({ applied: true, inserted: plan.insert.length, unchanged: plan.unchanged.length }))
  } finally {
    if (transaction) await transaction.rollback().catch(() => undefined)
    await closeProducerContractStore()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
