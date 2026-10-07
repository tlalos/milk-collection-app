import 'dotenv/config'
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getProducerContractPool, closeProducerContractStore } from '../server/producerContractStore.js'

export const approvedSourceHash = 'fb1c0c5b8e93f8a7820a3754260f999010bc7610793fd957fe0cfeb79cc0c861'
export const veterinaryDecisions = {
  skipNames: ['MORA ELVIRA', 'PRECUP DOCHIA', 'RUS TEODOR'],
  skipRows: [{ sourceRow: 183, producerName: 'CLAPA LAURENTIU DORU PFA' }],
  matchByTaxId: ['PETER GAVRIL'],
  largestCount: ['RUS MARIA LUDOVICA'],
}

const normalizeName = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
const normalizeTaxId = value => String(value ?? '').toUpperCase().replace(/\s+/g, '').replace(/^RO/, '')
const normalizeCode = value => String(value ?? '').trim().toLowerCase()

function savedValue(cell) {
  const value = cell.value
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    if (value.result == null) throw new Error(`${cell.address}: formula has no cached result.`)
    return value.result
  }
  return value
}

export function readVeterinaryHerdRows(workbook) {
  const sheet = workbook.getWorksheet('formular 1')
  if (!sheet) throw new Error('Missing formular 1 sheet.')
  for (const [address, header] of Object.entries({ C5: 'nume/denumire', D5: 'CNP/CUI', E3: 'Efectiv matca vaci de lapte (capete)' })) {
    if (normalizeName(savedValue(sheet.getCell(address))) !== normalizeName(header)) throw new Error(`Unexpected header in ${address}.`)
  }
  const rows = []
  let foundTotal = false
  for (let number = 6; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number)
    if (normalizeName(savedValue(row.getCell('A'))) === 'TOTAL') { foundTotal = true; break }
    const name = savedValue(row.getCell('C'))
    const taxId = savedValue(row.getCell('D'))
    const cowCount = savedValue(row.getCell('E'))
    if ([name, taxId, cowCount].every(value => value == null || value === '')) continue
    if (typeof name !== 'string' || !name.trim()) throw new Error(`C${number}: missing producer name.`)
    rows.push({ sourceRow: number, producerName: name.trim(), taxId: String(taxId ?? '').trim(), cowCount })
  }
  if (!foundTotal || !rows.length) throw new Error('Missing producer rows or total boundary in formular 1.')
  return rows
}

export function planVeterinaryHerdImport(rows, producers, contracts, decisions = veterinaryDecisions) {
  const names = values => new Set(values.map(normalizeName))
  const skipNames = names(decisions.skipNames)
  const taxNames = names(decisions.matchByTaxId)
  const largestCount = names(decisions.largestCount)
  const plan = { ready: [], skipped: [], merged: [], conflicts: [] }
  const groups = new Map()
  const refs = new Map()
  for (const producer of producers) {
    const key = normalizeCode(producer.producerCode)
    if (!key) continue
    const existing = refs.get(key)
    if (existing && (normalizeName(existing.producerName) !== normalizeName(producer.producerName) ||
      normalizeTaxId(existing.trn) !== normalizeTaxId(producer.trn))) throw new Error(`Inconsistent saved ERP identity for ${key}.`)
    refs.set(key, producer)
  }
  const referenceRows = [...refs.values()]
  for (const row of rows) {
    const name = normalizeName(row.producerName)
    const detail = { sourceRow: row.sourceRow, producerName: row.producerName }
    if (skipNames.has(name) || decisions.skipRows.some(skip => skip.sourceRow === row.sourceRow && normalizeName(skip.producerName) === name)) {
      plan.skipped.push({ ...detail, reason: 'Excluded by user.' }); continue
    }
    if (!Number.isSafeInteger(row.cowCount) || row.cowCount < 0) {
      plan.conflicts.push({ ...detail, reason: 'Missing or invalid cow count.' }); continue
    }
    const byName = referenceRows.filter(p => normalizeName(p.producerName) === name)
    const taxId = normalizeTaxId(row.taxId)
    const byTax = referenceRows.filter(p => taxId && normalizeTaxId(p.trn) === taxId)
    const matches = taxNames.has(name) ? byTax : byName
    if (matches.length !== 1) {
      plan.conflicts.push({ ...detail, reason: 'No unique approved ERP match.', candidateCodes: matches.map(p => normalizeCode(p.producerCode)) }); continue
    }
    const producer = matches[0]
    if (taxId && normalizeTaxId(producer.trn) !== taxId) {
      plan.conflicts.push({ ...detail, reason: 'Name and CNP/CUI disagree.' }); continue
    }
    const producerCode = normalizeCode(producer.producerCode)
    if (!/^p[^\s|]+$/.test(producerCode)) throw new Error(`Invalid ERP producer code: ${producerCode}`)
    const previous = groups.get(name)
    if (previous) {
      if (previous.producerCode !== producerCode || (previous.cowCount !== row.cowCount && !largestCount.has(name))) {
        plan.conflicts.push({ ...detail, reason: 'Duplicate name has conflicting producer codes or cow counts.' }); continue
      }
      previous.sourceRows.push(row.sourceRow)
      previous.cowCount = Math.max(previous.cowCount, row.cowCount)
      plan.merged.push({ ...detail, producerCode, reason: largestCount.has(name) ? 'Keep the largest count, not the sum.' : 'Same producer and count; keep once.' })
    } else {
      groups.set(name, {
        producerCode, producerName: producer.producerName, milkType: 'MILK-COW', cowCount: row.cowCount,
        sourceRows: [row.sourceRow], matchedBy: taxNames.has(name) ? 'cnp-cui' : 'name',
        hasContract: contracts.some(contract => normalizeCode(contract.producerCode) === producerCode && contract.milkType === 'MILK-COW'),
      })
    }
  }
  const codes = new Set()
  for (const row of groups.values()) {
    if (codes.has(row.producerCode)) plan.conflicts.push({ producerCode: row.producerCode, reason: 'Different workbook names map to the same producer code.' })
    codes.add(row.producerCode)
    plan.ready.push(row)
  }
  return plan
}

export async function main(args) {
  const [file, outputDirectory, ...extra] = args
  if (!file || !outputDirectory || extra.length) throw new Error('Usage: node scripts/prepareVeterinaryImport.mjs <workbook.xlsx> <output-directory> (read-only; no SQL changes)')
  const bytes = await readFile(path.resolve(file))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== approvedSourceHash) throw new Error('This workbook differs from the file reviewed by the user. Review the exclusions before proceeding.')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  const rows = readVeterinaryHerdRows(workbook)
  try {
    const pool = await getProducerContractPool()
    const target = (await pool.request().query("SELECT CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS serverName, DB_NAME() AS databaseName;")).recordset[0]
    const snapshot = (await pool.request().query("SELECT producersJson FROM dbo.OcrErpReferenceSnapshot WHERE snapshotKey=N'suppliers';")).recordset[0]
    if (!snapshot) throw new Error('No saved ERP producer list.')
    const contracts = (await pool.request().query('SELECT producerCode,milkType FROM dbo.ProducerContracts;')).recordset
    const plan = planVeterinaryHerdImport(rows, JSON.parse(snapshot.producersJson), contracts)
    const report = {
      mode: 'dry-run', applied: false, target,
      source: { file: path.basename(file), sheet: 'formular 1', sha256 },
      sourceRows: rows.length, decisions: veterinaryDecisions, ...plan,
      summary: {
        producers: plan.ready.length, cows: plan.ready.reduce((sum, row) => sum + row.cowCount, 0),
        skippedRows: plan.skipped.length, duplicateRowsMerged: plan.merged.length, conflicts: plan.conflicts.length,
        producersWithoutContract: plan.ready.filter(row => !row.hasContract).length,
      },
    }
    await mkdir(path.resolve(outputDirectory), { recursive: true })
    const output = path.join(path.resolve(outputDirectory), 'veterinary-import-review.json')
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
    console.log(JSON.stringify({ mode: report.mode, target, ...report.summary, output }, null, 2))
    if (plan.conflicts.length) throw new Error('Unresolved matches remain. See the review file.')
  } finally { await closeProducerContractStore() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
