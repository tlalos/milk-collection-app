import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import ExcelJS from 'exceljs'

async function loadModule(entry) {
  const built = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports)
  return compiled.exports
}
const { createApiaExcelDownload } = await loadModule('src/apiaExcelExport.ts')
const { apiaColumns, buildApiaProducerList } = await loadModule('src/apiaExport.ts')
const producer = (index, overrides = {}) => ({
  id: `P${index}`, producerCode: `P${index}`, producer: `Producer ${index}`, country: null,
  county: 'Cluj', taxId: '0012345678901', exploitationCode: 'RO0012345678',
  purchasedKg: 123.456789, missingReceptionFactor: false, warning: null, source: 'journal', ...overrides,
})

test('exports every row beyond a 25-row page with all fourteen columns', async () => {
  const rows = Array.from({ length: 61 }, (_, index) => producer(index))
  const download = await createApiaExcelDownload('2026-08', 'MILK-COW', rows)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(download.data)
  const sheet = workbook.getWorksheet('APIA')
  assert.equal(sheet.rowCount, 62)
  assert.equal(sheet.columnCount, 14)
  assert.deepEqual(sheet.getRow(1).values.slice(1), apiaColumns.map(column => column.label))
  assert.equal(sheet.getCell('A62').value, 'Producer 60')
  assert.equal(sheet.getCell('D2').value, '0012345678901')
  assert.equal(sheet.getCell('D2').numFmt, '@')
  assert.equal(sheet.getCell('E2').value, 'RO0012345678')
  assert.equal(sheet.getCell('J2').value, 123.456789)
  assert.equal(sheet.getCell('J2').numFmt, '0.00')
  for (const column of ['B', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N']) assert.equal(sheet.getCell(`${column}2`).value, null)
  assert.equal(download.filename, 'apia-2026-08-milk-cow.xlsx')
})

test('exports filtered journals and approved aviz together, leaving missing quantities blank', async () => {
  const rows = buildApiaProducerList([
    { month: '2026-08', milkType: 'MILK-COW', monthlyRows: [{ id: 'j1', producer: 'Journal', producerCode: 'P1', liters: 100 }] },
    { month: '2026-07', milkType: 'MILK-COW', monthlyRows: [{ id: 'j2', producer: 'July', producerCode: 'P2', liters: 100 }] },
    { month: '2026-08', milkType: 'MILK-SHEEP', monthlyRows: [{ id: 'j3', producer: 'Sheep', producerCode: 'P3', liters: 100 }] },
  ], '2026-08', 'MILK-COW', [
    { approvalId: 'a1', monthKey: '2026-08', producerName: 'Aviz', producerCode: 'P4', milkType: 'MILK-COW', approvedLiters: 50, status: 'APPROVED' },
  ], [], [])
  const download = await createApiaExcelDownload('2026-08', 'MILK-COW', rows)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(download.data)
  const sheet = workbook.getWorksheet('APIA')
  assert.equal(sheet.rowCount, 3)
  assert.deepEqual([sheet.getCell('A2').value, sheet.getCell('A3').value], ['Aviz', 'Journal'])
  assert.equal(sheet.getCell('J2').value, null)
  assert.equal(sheet.getCell('D3').value, null)
})

test('keeps formula-looking producer names as text and supports all milk types', async () => {
  const download = await createApiaExcelDownload('2026-08', '', [producer(1, { producer: '=1+1' })])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(download.data)
  assert.equal(workbook.getWorksheet('APIA').getCell('A2').value, '=1+1')
  assert.equal(download.filename, 'apia-2026-08-all-milk-types.xlsx')
})

test('rejects invalid month and empty exports', async () => {
  await assert.rejects(createApiaExcelDownload('2026-13', '', [producer(1)]), /valid month/)
  await assert.rejects(createApiaExcelDownload('2026-08', '', []), /No rows/)
})
