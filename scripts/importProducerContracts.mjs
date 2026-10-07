import 'dotenv/config'
import ExcelJS from 'exceljs'
import sql from 'mssql'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { closeProducerContractStore, getProducerContractPool, initializeProducerContracts, insertProducerContract, planProducerContractImport, selectProducerContractsSql, validateProducerContracts } from '../server/producerContractStore.js'

function savedValue(cell) {
  const value = cell.value
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    if (value.result == null) throw new Error(`${cell.address}: formula has no saved result. Recalculate and save the workbook in Excel first.`)
    return value.result
  }
  return value
}

function dateValue(cell) {
  const value = savedValue(cell)
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  throw new Error(`${cell.address}: expected an Excel date, not an ambiguous text date.`)
}

export function readElgoContracts(workbook) {
  const sheet = workbook.worksheets.find(item => item.name.trim().toLowerCase() === 'elgo')
  if (!sheet) throw new Error('The elgo sheet is missing.')
  const headers = { F: 'Numar contract', G: 'Data incheierii contractului', H: 'Data incetarii contractului', I: 'Cantitate de lapte contractata(total - kg)', V: 'Producer_Code (helper)' }
  for (const [column, header] of Object.entries(headers)) {
    if (String(sheet.getCell(`${column}1`).value || '').split('\n')[0].trim() !== header) throw new Error(`Unexpected header in ${column}1.`)
  }
  const rows = []
  sheet.eachRow((row, number) => {
    if (number === 1) return
    const values = ['F', 'G', 'H', 'I', 'V'].map(column => savedValue(row.getCell(column)))
    if (values.every(value => value == null || value === '')) return
    const contractNumber = values[0]
    if (typeof contractNumber !== 'string' && !(typeof contractNumber === 'number' && Number.isSafeInteger(contractNumber))) throw new Error(`F${number}: invalid contract number.`)
    rows.push({
      producerCode: String(values[4] ?? '').trim(), milkType: 'MILK-COW',
      contractNumber: String(contractNumber), contractStartDate: dateValue(row.getCell('G')),
      contractEndDate: dateValue(row.getCell('H')), contractedKg: values[3], sourceRow: number,
    })
  })
  return validateProducerContracts(rows)
}

export async function main(args) {
  const [file, ...flags] = args
  let apply = false
  let confirmTarget = ''
  if (!file) throw new Error('Usage: node scripts/importProducerContracts.mjs <workbook.xlsx> [--apply --confirm-target "SERVER/DATABASE"]')
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--apply') apply = true
    else if (flags[i] === '--confirm-target' && flags[i + 1]) confirmTarget = flags[++i]
    else throw new Error(`Unknown or incomplete option: ${flags[i]}`)
  }
  const bytes = await readFile(path.resolve(file))
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  const rows = readElgoContracts(workbook)
  const source = { file: path.basename(file), sheet: 'elgo', sha256: createHash('sha256').update(bytes).digest('hex') }
  return importContractRows(rows, source, { apply, confirmTarget })
}

export async function importContractRows(inputRows, source, { apply = false, confirmTarget = '' } = {}) {
  const rows = validateProducerContracts(inputRows)
  let transaction
  try {
    const pool = await getProducerContractPool()
    const target = (await pool.request().query("SELECT CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS serverName, DB_NAME() AS databaseName;")).recordset[0]
    const targetLabel = `${target.serverName}/${target.databaseName}`
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', target: targetLabel, source, contracts: rows.length }, null, 2))
    if (apply && confirmTarget !== targetLabel) throw new Error('Use --confirm-target with the exact target from the dry run.')
    if (apply) {
      await initializeProducerContracts()
      transaction = new sql.Transaction(pool)
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    }
    const request = () => transaction ? new sql.Request(transaction) : pool.request()
    const references = (await request().query("SELECT producersJson FROM dbo.OcrErpReferenceSnapshot WHERE snapshotKey=N'suppliers';")).recordset[0]
    if (!references) throw new Error('Fetch and save the ERP producer list before importing contracts.')
    const producers = JSON.parse(references.producersJson)
    const exists = (await request().query("SELECT OBJECT_ID(N'dbo.ProducerContracts', N'U') AS tableId;")).recordset[0].tableId
    const current = exists ? (await request().query(`${selectProducerContractsSql}${apply ? ' WITH (UPDLOCK,HOLDLOCK)' : ''};`)).recordset : []
    const plan = planProducerContractImport(rows, current, producers)
    console.log(JSON.stringify({ wouldInsert: plan.insert.length, unchanged: plan.unchanged.length, conflicts: plan.conflicts }, null, 2))
    if (plan.conflicts.length) throw new Error('Conflicts found. No contract records were imported.')
    if (!apply) return
    for (const row of plan.insert) await insertProducerContract(transaction, row, row.source || source, 'contract-import')
    const after = (await request().query(`${selectProducerContractsSql};`)).recordset
    const verified = planProducerContractImport(rows, after, producers)
    if (verified.insert.length || verified.conflicts.length || verified.unchanged.length !== rows.length) throw new Error('Verification failed; rolling back all imported contracts.')
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
