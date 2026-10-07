import { veterinaryAnimalGroups, type VeterinaryProducerRow } from './veterinaryExport'
import type { Cell, Border } from 'exceljs'

function numberFormat(value: unknown) {
  // Optional-only decimal placeholders leave a trailing separator in Excel.
  const decimals = typeof value === 'number' ? (Number(value.toFixed(3)).toString().split('.')[1]?.length || 0) : 0
  return decimals ? `#,##0.${'0'.repeat(decimals)}` : '#,##0'
}

function styleCell(cell: Cell, header = false) {
  const edge: Partial<Border> = { style: header ? 'medium' : 'thin', color: { argb: 'FF000000' } }
  cell.border = { top: edge, bottom: edge, left: edge, right: edge }
  cell.font = { name: 'Calibri', size: 10, bold: header, color: { argb: 'FF000000' } }
  cell.alignment = { vertical: 'middle', wrapText: true, ...(header ? { horizontal: 'center' as const } : {}) }
  if (header) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFADACAC' } }
}

export async function createVeterinaryExcelDownload(month: string, form: 1 | 2, rows: VeterinaryProducerRow[]) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Select a valid month before exporting.')
  if (form !== 1 && form !== 2) throw new Error('Select a valid form.')
  if (!rows.length) throw new Error('No rows to export.')
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(`Formular ${form}`)
  const columnCount = form === 1 ? 11 : 7
  const headerEnd = form === 1 ? 5 : 4
  const lastColumn = form === 1 ? 'K' : 'G'
  sheet.columns = (form === 1 ? [6, 14, 26, 20, 14, 26, 20, 14, 26, 20, 14] : [7, 23, 38, 21, 24, 24, 24]).map(width => ({ width }))
  const [year, monthNumber] = month.split('-').map(Number)
  sheet.getRow(1).values = form === 1
    ? ['Raport DSVSA Judetul', null, null, 'BN', 'ANUL', year, 'Luna', new Date(Date.UTC(year, monthNumber - 1, 1))]
    : ['Raport DSVSA Judetul', null, 'BN', 'ANUL', year, 'Luna', new Date(Date.UTC(year, monthNumber - 1, 1))]
  sheet.mergeCells(form === 1 ? 'A1:C1' : 'A1:B1')
  sheet.getRow(1).height = 28
  const metaEnd = form === 1 ? 8 : 7
  for (let column = 1; column <= metaEnd; column++) {
    const cell = sheet.getCell(1, column)
    styleCell(cell, true)
    cell.font = { name: 'Calibri', size: 12, bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
  }
  for (const [address, color] of [
    ['A1', 'FFFF0000'], [form === 1 ? 'E1' : 'D1', 'FFFFFF00'],
    [form === 1 ? 'F1' : 'E1', 'FFFFFF00'], [form === 1 ? 'G1' : 'F1', 'FF0070C0'],
  ]) sheet.getCell(address).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
  sheet.getCell(form === 1 ? 'H1' : 'G1').numFmt = 'mmm-yy'
  sheet.mergeCells(`A2:${lastColumn}2`)
  sheet.getCell('A2').value = `Formular nr. ${form}`
  sheet.getCell('A2').font = { name: 'Calibri', bold: true, size: 11 }
  sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.getRow(2).height = 24
  if (form === 1) {
    sheet.getRow(3).values = ['Nr. crt', 'Jude\u021b', 'Exploata\u021bii de vaci de lapte', null,
      'Efectiv matc\u0103 vaci de lapte (capete)', 'Exploata\u021bie de bivoli\u021be', null,
      'Efectiv matc\u0103 bivoli\u021be (capete)', 'Exploata\u021bie de oi/capre (nume/denumire)', null,
      'Efectiv matc\u0103 oi/ capre (capete)']
    sheet.getRow(5).values = [null, null, ...veterinaryAnimalGroups.flatMap(() => ['nume/denumire', 'CNP/CUI', null])]
    sheet.mergeCells('A3:A5')
    sheet.mergeCells('B3:B5')
    veterinaryAnimalGroups.forEach((_, index) => {
      const column = 3 + index * 3
      sheet.mergeCells(3, column, 4, column + 1)
      sheet.mergeCells(3, column + 2, 5, column + 2)
    })
  } else {
    sheet.getRow(3).values = ['Nr. crt.', 'Jude\u021b', 'Exploata\u021bii', null,
      'Produc\u021bii de lapte de vac\u0103 - total (litri)', 'Produc\u021bii de lapte de bivoli\u021be - total (litri)', 'Produc\u021bii de lapte de oi/capre - total (litri)']
    sheet.getRow(4).values = [null, null, 'nume/denumire', 'CNP/CUI']
    for (const column of ['A', 'B', 'E', 'F', 'G']) sheet.mergeCells(`${column}3:${column}4`)
    sheet.mergeCells('C3:D3')
  }
  for (let index = 3; index <= headerEnd; index++) {
    sheet.getRow(index).height = index === 3 ? 36 : 24
    for (let column = 1; column <= columnCount; column++) styleCell(sheet.getCell(index, column), true)
  }
  sheet.views = [{ state: 'frozen', ySplit: headerEnd }]
  rows.forEach((row, index) => {
    const values = form === 1
      ? veterinaryAnimalGroups.flatMap(animal => row.animalGroups.includes(animal.key) ? [row.producer, row.taxId, row.animalCounts?.[animal.key] ?? null] : [null, null, null])
      : [row.producer, row.taxId, ...veterinaryAnimalGroups.map(animal => row.animalGroups.length && Number.isFinite(row.liters[animal.key]) && row.liters[animal.key] > 0 ? row.liters[animal.key] : null)]
    // Preserve unidentified producers without assigning them to an animal category.
    if (form === 1 && !row.animalGroups.length) values[0] = row.producer
    const excelRow = sheet.addRow([index + 1, row.county, ...values])
    excelRow.height = 32
    for (let column = 1; column <= columnCount; column++) styleCell(excelRow.getCell(column))
    if (form === 2) for (const column of [5, 6, 7]) {
      const cell = excelRow.getCell(column)
      cell.numFmt = numberFormat(cell.value)
    }
    const warnings = [row.warning, row.hasUnclassifiedMilk ? 'Unidentified milk type' : null].filter(Boolean).join('\n')
    if (warnings) excelRow.getCell(3).note = warnings
  })
  const lastDataRow = headerEnd + rows.length
  // Apply body formats only: metadata shares the same columns as identifiers/counts.
  for (let row = headerEnd + 1; row <= lastDataRow; row++) {
    for (const column of form === 1 ? [4, 7, 10] : [4]) sheet.getCell(row, column).numFmt = '@'
    if (form === 1) for (const column of [5, 8, 11]) sheet.getCell(row, column).numFmt = '#,##0'
  }
  const totalRow = lastDataRow + 1
  sheet.mergeCells(`A${totalRow}:D${totalRow}`)
  sheet.getCell(totalRow, 1).value = 'Total'
  if (form === 1) for (const [start, end] of [[6, 7], [9, 10]]) {
    sheet.mergeCells(totalRow, start, totalRow, end)
    sheet.getCell(totalRow, start).value = 'Total'
  }
  for (const column of form === 1 ? [5, 8, 11] : [5, 6, 7]) {
    const cell = sheet.getCell(totalRow, column)
    const values = Array.from({ length: rows.length }, (_, index) => sheet.getCell(headerEnd + 1 + index, column).value)
      .filter((value): value is number => typeof value === 'number')
    const result = values.length ? values.reduce((sum, value) => sum + value, 0) : ''
    const letter = sheet.getColumn(column).letter
    const range = `${letter}${headerEnd + 1}:${letter}${lastDataRow}`
    cell.value = values.length ? { formula: `IF(COUNT(${range})=0,"",SUM(${range}))`, result } : null
    cell.numFmt = numberFormat(result)
  }
  sheet.getRow(totalRow).height = 26
  for (let column = 1; column <= columnCount; column++) styleCell(sheet.getCell(totalRow, column), true)

  const notes = [form === 1
    ? '* Nota - La coloanele : Efectiv matca vaci, matca bivolite, matca oi/capre, se vor introduce doar caractere numerice'
    : '* Nota * La coloanele : Productii de lapte de vaca, bivolite si oi/capre, se vor introduce doar caractere numerice, unitate de masura LITRU',
  '** Nota - Se pot insera doar randuri']
  notes.forEach((text, index) => {
    const row = totalRow + 2 + index
    sheet.mergeCells(`A${row}:${lastColumn}${row}`)
    sheet.getCell(row, 1).value = text
    sheet.getCell(row, 1).font = { name: 'Calibri', size: 10 }
    sheet.getCell(row, 1).alignment = { wrapText: true, vertical: 'middle' }
    sheet.getRow(row).height = index === 0 ? 30 : 20
  })
  const signatures = ['Director executiv,', 'Director executiv adjunct,', '\u0218ef Serviciu/Birou/Compartiment,']
  signatures.forEach((text, index) => {
    const column = 2 + index * 2
    for (const row of [totalRow + 5, totalRow + 6]) sheet.mergeCells(row, column, row, column + 1)
    const cell = sheet.getCell(totalRow + 5, column)
    cell.value = text
    cell.font = { name: 'Calibri', size: 10 }
    cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'center' }
  })
  sheet.getRow(totalRow + 5).height = 30
  sheet.getRow(totalRow + 6).height = 36
  sheet.pageSetup = {
    orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: `1:${headerEnd}`, printArea: `A1:${lastColumn}${totalRow + 6}`,
    margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  }
  return {
    filename: `veterinary-formular-${form}-${month}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    data: new Uint8Array(await workbook.xlsx.writeBuffer()),
  }
}
