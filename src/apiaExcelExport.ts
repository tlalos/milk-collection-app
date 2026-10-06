import { apiaColumns, type ApiaProducerRow } from './apiaExport'

export async function createApiaExcelDownload(month: string, milkType: string, rows: ApiaProducerRow[]) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Select a valid month before exporting.')
  if (!rows.length) throw new Error('No rows to export.')
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('APIA')
  sheet.columns = apiaColumns.map(column => ({ key: column.key, width: Math.max(14, column.width / 7) }))
  sheet.addRow(apiaColumns.map(column => column.label))
  sheet.getRow(1).height = 76
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF163F2B' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0E6F5' } }
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: apiaColumns.length } }
  for (const row of rows) {
    sheet.addRow(apiaColumns.map(column => {
      switch (column.key) {
        case 'producer': return row.producer
        case 'country': return row.country
        case 'county': return row.county
        case 'taxId': return row.taxId
        case 'exploitationCode': return row.exploitationCode
        case 'purchasedKg': return row.purchasedKg != null && Number.isFinite(row.purchasedKg) ? row.purchasedKg : null
        default: return null
      }
    }))
  }
  for (const key of ['producer', 'country', 'county', 'taxId', 'exploitationCode', 'contractNumber', 'apiaCode', 'organic']) {
    sheet.getColumn(key).numFmt = '@'
  }
  sheet.getColumn('purchasedKg').numFmt = '0.00'
  const type = milkType.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'all-milk-types'
  return {
    filename: `apia-${month}-${type}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    data: new Uint8Array(await workbook.xlsx.writeBuffer()),
  }
}
