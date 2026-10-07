import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import ExcelJS from 'exceljs'

const built = await build({ entryPoints: ['src/veterinaryExcelExport.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
const compiled = { exports: {} }
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports)
const { createVeterinaryExcelDownload } = compiled.exports
const producer = (index, overrides = {}) => ({
  id: `P${index}`, producerCode: `P${index}`, producer: `Producer ${index}`, county: 'Cluj', taxId: '0012345678901',
  source: 'journal', warning: null, hasUnclassifiedMilk: false, animalGroups: ['cow', 'sheepGoat'],
  liters: { cow: 123.45678, buffalo: 0, sheepGoat: 45.6789 }, ...overrides,
})
async function exportSheet(form, rows) {
  const download = await createVeterinaryExcelDownload('2026-09', form, rows)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(download.data)
  return { download, sheet: workbook.getWorksheet(`Formular ${form}`) }
}

test('Formular 2 exports the complete list, numeric liters and text identifiers', async () => {
  const { download, sheet } = await exportSheet(2, Array.from({ length: 65 }, (_, index) => producer(index)))
  assert.equal(sheet.rowCount, 76)
  assert.equal(sheet.columnCount, 7)
  assert.equal(sheet.getCell('A2').value, 'Formular nr. 2')
  assert.equal(sheet.getCell('C69').value, 'Producer 64')
  assert.equal(sheet.getCell('A69').value, 65)
  assert.equal(sheet.getCell('D5').value, '0012345678901')
  assert.equal(sheet.getCell('D5').numFmt, '@')
  assert.equal(sheet.getCell('E5').value, 123.45678)
  assert.equal(sheet.getCell('F5').value, null)
  assert.equal(sheet.getCell('G5').value, 45.6789)
  assert.equal(sheet.views[0].ySplit, 4)
  assert.equal(download.filename, 'veterinary-formular-2-2026-09.xlsx')
})

test('Formular 1 keeps species membership and leaves animal counts blank', async () => {
  const { sheet } = await exportSheet(1, [producer(1)])
  assert.equal(sheet.columnCount, 11)
  assert.equal(sheet.getCell('C6').value, 'Producer 1')
  assert.equal(sheet.getCell('I6').value, 'Producer 1')
  assert.equal(sheet.getCell('D6').value, '0012345678901')
  for (const column of ['E', 'F', 'G', 'H', 'K']) assert.equal(sheet.getCell(`${column}6`).value, null)
  assert.equal(sheet.views[0].ySplit, 5)
})

test('whole liters have no decimal separator, fractions retain numeric precision, and zeros are blank', async () => {
  const { sheet } = await exportSheet(2, [
    producer(1, { liters: { cow: 136, buffalo: 0, sheepGoat: 12.5 } }),
    producer(2, { liters: { cow: 123.45678, buffalo: NaN, sheepGoat: 1207 } }),
  ])
  assert.equal(sheet.getCell('E5').value, 136)
  assert.equal(sheet.getCell('E5').numFmt, '#,##0')
  assert.equal(sheet.getCell('F5').value, null)
  assert.equal(sheet.getCell('G5').numFmt, '#,##0.0')
  assert.equal(sheet.getCell('E6').value, 123.45678)
  assert.equal(sheet.getCell('E6').numFmt, '#,##0.000')
  assert.equal(sheet.getCell('F6').value, null)
  assert.equal(sheet.getCell('G6').numFmt, '#,##0')
})

test('unclassified milk stays blank and warnings are retained as notes', async () => {
  const row = producer(1, { animalGroups: [], hasUnclassifiedMilk: true, warning: 'No ERP match', producer: '=1+1' })
  const { sheet } = await exportSheet(2, [row])
  assert.equal(sheet.getCell('C5').value, '=1+1')
  for (const column of ['E', 'F', 'G']) assert.equal(sheet.getCell(`${column}5`).value, null)
  assert.ok(sheet.getCell('C5').note)
  const form1 = await exportSheet(1, [row])
  assert.equal(form1.sheet.getCell('C6').value, '=1+1')
})

test('rejects invalid filters and empty lists', async () => {
  await assert.rejects(createVeterinaryExcelDownload('2026-13', 2, [producer(1)]), /valid month/)
  await assert.rejects(createVeterinaryExcelDownload('2026-09', 3, [producer(1)]), /valid form/)
  await assert.rejects(createVeterinaryExcelDownload('2026-09', 2, []), /No rows/)
})

test('Formular 1 exports numeric animal counts and leaves unknown and absent species blank', async () => {
  const { sheet } = await exportSheet(1, [producer(1, { animalCounts: { cow: 4, buffalo: 9, sheepGoat: null } })])
  assert.equal(sheet.getCell('E6').value, 4)
  assert.equal(sheet.getCell('E6').numFmt, '#,##0')
  assert.equal(sheet.getCell('H6').value, null)
  assert.equal(sheet.getCell('K6').value, null)
})

for (const form of [1, 2]) test(`Formular ${form} matches the source report structure with the selected month`, async () => {
  const { sheet } = await exportSheet(form, [producer(1, { animalCounts: { cow: 4 } })])
  assert.equal(sheet.getCell('A1').value, 'Raport DSVSA Judetul')
  assert.equal(sheet.getCell(form === 1 ? 'D1' : 'C1').value, 'BN')
  assert.equal(sheet.getCell(form === 1 ? 'F1' : 'E1').value, 2026)
  const month = sheet.getCell(form === 1 ? 'H1' : 'G1')
  assert.equal(month.value.toISOString(), '2026-09-01T00:00:00.000Z')
  assert.equal(month.numFmt, 'mmm-yy')
  assert.equal(sheet.getCell('A1').fill.fgColor.argb, 'FFFF0000')
  assert.equal(sheet.getCell('C3').fill.fgColor.argb, 'FFADACAC')
  assert.equal(sheet.getCell('C3').border.top.style, 'medium')
  assert.equal(sheet.getCell(form === 1 ? 'C6' : 'C5').border.top.style, 'thin')
  assert.equal(sheet.getCell('B3').value, 'Jude\u021b')
  const merges = sheet.model.merges
  for (const range of form === 1
    ? ['A1:C1', 'A2:K2', 'A3:A5', 'C3:D4', 'E3:E5', 'F3:G4', 'I3:J4']
    : ['A1:B1', 'A2:G2', 'A3:A4', 'C3:D3', 'E3:E4']) assert.ok(merges.includes(range), range)
  assert.equal(sheet.getCell(form === 1 ? 'C5' : 'C4').value, 'nume/denumire')
  const total = form === 1 ? 7 : 6
  assert.equal(sheet.getCell(total, 1).value, 'Total')
  assert.equal(sheet.getCell(total, 5).result, form === 1 ? 4 : 123.45678)
  assert.match(sheet.getCell(total, 5).formula, /IF\(COUNT/)
  assert.equal(sheet.getCell(total, form === 1 ? 8 : 6).value, null)
  assert.match(sheet.getCell(total + 2, 1).value, /caractere numerice/)
  assert.equal(sheet.getCell(total + 5, 2).value, 'Director executiv,')
  assert.equal(sheet.pageSetup.orientation, 'landscape')
  assert.equal(sheet.pageSetup.fitToWidth, 1)
  assert.equal(sheet.pageSetup.printTitlesRow, form === 1 ? '1:5' : '1:4')
  assert.equal(sheet.pageSetup.printArea, `A1:${form === 1 ? 'K13' : 'G12'}`)
})
