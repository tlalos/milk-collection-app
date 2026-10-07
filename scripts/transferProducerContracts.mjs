import 'dotenv/config'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { closeProducerContractStore, getProducerContractPool, validateProducerContracts } from '../server/producerContractStore.js'
import { importContractRows } from './importProducerContracts.mjs'

const checksum = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex')
const fields = ['producerCode', 'milkType', 'contractNumber', 'contractStartDate', 'contractEndDate', 'contractedKg', 'sourceRow', 'source']

export function createContractSnapshot(rows, sourceDatabase) {
  const snapshot = { formatVersion: 1, sourceTable: 'dbo.ProducerContracts', sourceDatabase, exportedAt: new Date().toISOString(), rowCount: rows.length, checksum: checksum(rows), rows }
  validateContractSnapshot(snapshot)
  return snapshot
}

export function validateContractSnapshot(snapshot) {
  if (snapshot?.formatVersion !== 1 || snapshot.sourceTable !== 'dbo.ProducerContracts' || !Array.isArray(snapshot.rows) ||
    snapshot.rowCount !== snapshot.rows.length || snapshot.checksum !== checksum(snapshot.rows) ||
    !snapshot.sourceDatabase?.serverName || !snapshot.sourceDatabase?.databaseName) throw new Error('Invalid or changed producer contract snapshot.')
  validateProducerContracts(snapshot.rows)
  for (const row of snapshot.rows) {
    if (Object.keys(row).some(key => !fields.includes(key))) throw new Error('Unexpected contract snapshot fields.')
    const source = row.source
    if (!source || Object.keys(source).some(key => !['file', 'sheet', 'sha256'].includes(key)) ||
      typeof source.file !== 'string' || !source.file.trim() || source.file.length > 260 ||
      typeof source.sheet !== 'string' || !source.sheet.trim() || source.sheet.length > 80 ||
      !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('Invalid contract source information.')
  }
  return snapshot
}

async function exportContracts(directory) {
  try {
    const pool = await getProducerContractPool()
    const sourceDatabase = (await pool.request().query("SELECT CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS serverName, DB_NAME() AS databaseName;")).recordset[0]
    const records = (await pool.request().query(`SELECT producerCode,milkType,contractNumber,
      CONVERT(char(10),contractStartDate,23) AS contractStartDate,
      CONVERT(char(10),contractEndDate,23) AS contractEndDate,contractedKg,
      sourceRow,sourceFile,sourceSheet,sourceSha256
      FROM dbo.ProducerContracts ORDER BY producerCode,milkType,contractStartDate;`)).recordset
    const rows = records.map(({ sourceFile, sourceSheet, sourceSha256, ...row }) => ({ ...row, source: { file: sourceFile, sheet: sourceSheet, sha256: sourceSha256 } }))
    const snapshot = createContractSnapshot(rows, sourceDatabase)
    const output = path.resolve(directory)
    await mkdir(output, { recursive: true })
    const file = path.join(output, 'producer-contracts.json')
    await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' })
    console.log(JSON.stringify({ file, contracts: snapshot.rowCount, checksum: snapshot.checksum, sourceDatabase }, null, 2))
  } finally { await closeProducerContractStore() }
}

export async function main(args) {
  const [command, file, ...flags] = args
  if (command === 'export' && file && !flags.length) return exportContracts(file)
  if (command === 'import' && file) {
    let apply = false
    let confirmTarget = ''
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === '--apply') apply = true
      else if (flags[i] === '--confirm-target' && flags[i + 1]) confirmTarget = flags[++i]
      else throw new Error(`Unknown or incomplete option: ${flags[i]}`)
    }
    const snapshot = validateContractSnapshot(JSON.parse(await readFile(path.resolve(file), 'utf8')))
    return importContractRows(snapshot.rows, { snapshot: path.basename(file), checksum: snapshot.checksum }, { apply, confirmTarget })
  }
  throw new Error('Usage: node scripts/transferProducerContracts.mjs export <directory> OR import <producer-contracts.json> [--apply --confirm-target "SERVER/DATABASE"]')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
