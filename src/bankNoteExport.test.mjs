import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
const built = await build({ entryPoints: ['src/bankNoteExport.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' })
const compiled = { exports: {} }
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports)
const { prepareBankExport, bankExportIssues, createBankExportWorkbook, createBankExportDownload, BANK_PAYER_IBAN, BANK_EXPORT_HEADERS } = compiled.exports
const source = (overrides = {}) => ({
  id: '1', producerCode: 'P1', producerName: 'ANA POP', milkType: 'COW', totalLiters: 100,
  finalAmount: 125.5, comment: '', connectedProducer: null,
  paymentProducer: { iban: 'RO123', producerName: 'ANA POP' }, ...overrides,
})

test('Romanian comments use selected month, independent of invoice date', () => {
  const row = source({ comment: 'Factura 12' })
  assert.equal(prepareBankExport('2026-08', [row], [row])[0].comment, 'Lapte august 2026 - Factura 12')
  assert.throws(() => prepareBankExport('2026-19', [row], [row]), /valid month/)
})
test('multiple milk types remain separate and are detected outside current selection', () => {
  const cow = source()
  const sheep = source({ id: '2', milkType: 'MILK-SHEEP' })
  const buff = source({ id: '3', milkType: 'BUFF' })
  const rows = prepareBankExport('2026-07', [cow, sheep, buff], [cow, sheep, buff])
  assert.deepEqual(rows.map(row => row.comment), ['Lapte vaca iulie 2026', 'Lapte oaie iulie 2026', 'Lapte buff iulie 2026'])
  assert.equal(prepareBankExport('2026-07', [cow], [cow, sheep])[0].comment, rows[0].comment)
})
test('connected payment uses recipient account and name, retaining source producer in comment', () => {
  const original = source({ connectedProducer: { producerName: 'ION POP' }, paymentProducer: { iban: 'RO456', producerName: 'ION POP' } })
  const [row] = prepareBankExport('2026-08', [original], [original])
  assert.equal(row.recipientName, 'ION POP')
  assert.equal(row.iban, 'RO456')
  assert.equal(row.comment, 'Lapte august 2026 - ANA POP')
  assert.equal(row.producerName, 'ANA POP')
})
test('review rejects missing fields and overlong values without truncation', async () => {
  const original = source({ producerName: 'A'.repeat(41), paymentProducer: { iban: 'RO123', producerName: 'A'.repeat(41) }, comment: 'B'.repeat(70) })
  const [row] = prepareBankExport('2026-08', [original], [original])
  assert.equal(row.recipientName.length, 41)
  assert.equal(bankExportIssues(row).length, 2)
  await assert.rejects(createBankExportWorkbook([row]), /40 characters/)
  assert.equal(bankExportIssues({ ...row, recipientName: 'A'.repeat(40), comment: 'B'.repeat(70) }).length, 0)
  assert.equal(bankExportIssues({ ...row, recipientName: '', comment: '', iban: '', amount: null }).length, 4)
})
test('real xlsx preserves template columns, numeric amounts, text safety, and empty bank reference fields', async () => {
  const original = source()
  const rows = prepareBankExport('2026-08', [original], [original])
  rows[0].recipientName = '=NOT_A_FORMULA'
  rows[0].comment = 'Lapte august 2026 & regularizare'
  const snapshot = structuredClone(rows)
  const buffer = await createBankExportWorkbook(rows)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  assert.equal(workbook.worksheets.length, 1)
  const sheet = workbook.getWorksheet('Sheet1')
  assert.deepEqual(sheet.getRow(1).values.slice(1), BANK_EXPORT_HEADERS)
  assert.deepEqual(sheet.getRow(2).values.slice(1), [BANK_PAYER_IBAN, 'RO123', 125.5, 'lei', '=NOT_A_FORMULA', 'Lapte august 2026 & regularizare', 1, '', ''])
  assert.equal(sheet.getCell('C2').numFmt, '0.00')
  assert.equal(sheet.getCell('A2').numFmt, '@')
  assert.equal(sheet.rowCount, 2)
  assert.deepEqual(rows, snapshot)
})

function payments(count) {
  const sources = Array.from({ length: count }, (_, index) => source({ id: String(index), comment: String(index) }))
  return prepareBankExport('2026-08', sources, sources)
}

test('99 payments download as one xlsx with exactly 100 rows including header', async () => {
  const download = await createBankExportDownload('2026-08', payments(99))
  assert.equal(download.filename, 'bank-note-2026-08.xlsx')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(download.data)
  const sheet = workbook.worksheets[0]
  assert.equal(sheet.rowCount, 100)
  assert.equal(sheet.getCell('G2').value, 1)
  assert.equal(sheet.getCell('G100').value, 99)
  assert.equal(sheet.getCell('G2').numFmt, '0')
})

for (const count of [100, 198, 199, 298]) {
  test(`${count} payments split into numbered bank files without lost or duplicate rows`, async () => {
    const rows = payments(count)
    const download = await createBankExportDownload('2026-08', rows)
    assert.equal(download.filename, 'bank-note-2026-08.zip')
    assert.equal(download.mimeType, 'application/zip')
    const zip = await JSZip.loadAsync(download.data)
    const files = Object.values(zip.files).filter(file => !file.dir).sort((a, b) => a.name.localeCompare(b.name))
    assert.equal(files.length, Math.ceil(count / 99))
    const numbers = [], comments = []
    let total = 0
    for (const file of files) {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.async('uint8array'))
      assert.equal(workbook.worksheets.length, 1)
      const sheet = workbook.worksheets[0]
      assert.ok(sheet.rowCount <= 100)
      assert.ok(sheet.rowCount > 1)
      assert.deepEqual(sheet.getRow(1).values.slice(1), BANK_EXPORT_HEADERS)
      for (let index = 2; index <= sheet.rowCount; index++) {
        numbers.push(sheet.getCell(`G${index}`).value)
        comments.push(sheet.getCell(`F${index}`).value)
        total += sheet.getCell(`C${index}`).value
      }
    }
    assert.deepEqual(numbers, Array.from({ length: count }, (_, index) => index + 1))
    assert.deepEqual(comments, rows.map(row => row.comment))
    assert.equal(total, count * 125.5)
  })
}

test('oversize standalone files and invalid later batches are rejected', async () => {
  await assert.rejects(createBankExportWorkbook(payments(100)), /at most 99/)
  await assert.rejects(createBankExportWorkbook(payments(1), 0), /payment number/)
  const rows = payments(100)
  rows[99].comment = 'a'.repeat(71)
  await assert.rejects(createBankExportDownload('2026-08', rows), /70 characters/)
  await assert.rejects(createBankExportDownload('2026-13', payments(1)), /valid month/)
  await assert.rejects(createBankExportDownload('2026-08', []), /at least one/)
})
