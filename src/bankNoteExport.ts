export const BANK_PAYER_IBAN = 'RO46RZBR0000060022847527'
export const BANK_EXPORT_MAX_PAYMENTS = 99
export const BANK_EXPORT_HEADERS = [
  'IBAN Platitor', 'IBAN Beneficiar', 'Suma', 'Moneda (Lei/Euro)',
  'Nume beneficiar (maxim 40 de caractere)', 'Descriere (maxim 70 de caractere)',
  'Numar ordin de plata (doar pentru platile interbancare sau catre trezorerie)',
  'Numar identificare beneficiar (CNP sau CUI, doar pentru platile catre trezorerie)',
  'Numar de evidenta (doar catre platile catre trezorerie, optional)',
]

type ProducerMilk = { producerCode: string; producer?: string; producerName?: string; milkType: string }
export type BankExportSource = ProducerMilk & {
  id: string; producerName: string; totalLiters: number; finalAmount: number | null
  comment: string; connectedProducer: { producerName: string } | null
  paymentProducer: { iban?: string; producerName?: string } | null
}
export type BankExportRow = {
  id: string; producerName: string; recipientName: string; iban: string; amount: number | null
  totalLiters: number; milkType: string; comment: string
}
const key = (row: ProducerMilk) => (row.producerCode || row.producerName || row.producer || '').trim().toUpperCase()
const milkType = (type: string) => type.trim().toUpperCase().replace(/^MILK-/, '')
const milkNames: Record<string, string> = { COW: 'vaca', SHEEP: 'oaie', BUFF: 'buff' }
const months = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']

export function prepareBankExport(month: string, selected: BankExportSource[], allProducers: ProducerMilk[]): BankExportRow[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Select a valid month before exporting.')
  const types = new Map<string, Set<string>>()
  for (const row of allProducers) {
    const producer = key(row)
    if (!types.has(producer)) types.set(producer, new Set())
    types.get(producer)!.add(milkType(row.milkType))
  }
  return selected.map(row => {
    const type = milkType(row.milkType)
    const milk = (types.get(key(row))?.size ?? 0) > 1 ? ` ${milkNames[type] || type.toLowerCase()}` : ''
    const originalProducer = row.connectedProducer ? ` - ${row.producerName}` : ''
    const extraComment = row.comment.trim() ? ` - ${row.comment.trim()}` : ''
    return {
      id: row.id, producerName: row.producerName, totalLiters: row.totalLiters, milkType: type,
      recipientName: row.paymentProducer?.producerName || row.producerName,
      iban: row.paymentProducer?.iban?.trim() || '', amount: row.finalAmount,
      comment: `Lapte${milk} ${months[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}${originalProducer}${extraComment}`,
    }
  })
}

export function bankExportIssues(row: BankExportRow): string[] {
  const issues: string[] = []
  if (!row.recipientName.trim()) issues.push('Recipient name is required.')
  if (row.recipientName.trim().length > 40) issues.push('Recipient name exceeds 40 characters.')
  if (!row.comment.trim()) issues.push('Comment is required.')
  if (row.comment.trim().length > 70) issues.push('Comment exceeds 70 characters.')
  if (!row.iban.trim()) issues.push('Recipient IBAN is missing.')
  if (row.amount === null || !Number.isFinite(row.amount)) issues.push('Final amount is missing.')
  return issues
}

function validateBankExportRows(rows: BankExportRow[]) {
  if (!rows.length) throw new Error('Select at least one payment.')
  for (const row of rows) {
    const issues = bankExportIssues(row)
    if (issues.length) throw new Error(`${row.producerName}: ${issues.join(' ')}`)
  }
}

export async function createBankExportWorkbook(rows: BankExportRow[], firstPaymentNumber = 1) {
  validateBankExportRows(rows)
  if (rows.length > BANK_EXPORT_MAX_PAYMENTS) throw new Error('Each bank file can contain at most 99 payments plus the header.')
  if (!Number.isSafeInteger(firstPaymentNumber) || firstPaymentNumber < 1) throw new Error('Invalid first payment number.')
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet1')
  const widths = [30.44, 37.66, 20.11, 12.66, 42, 72, 27.33, 24.33, 33.11]
  sheet.columns = widths.map(width => ({ width }))
  sheet.addRow(BANK_EXPORT_HEADERS)
  sheet.getRow(1).height = 71.25
  sheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F00E' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  })
  for (const [index, row] of rows.entries()) {
    sheet.addRow([BANK_PAYER_IBAN, row.iban, Math.round(row.amount! * 100) / 100, 'lei', row.recipientName.trim(), row.comment.trim(), firstPaymentNumber + index, '', ''])
  }
  for (const column of [1, 2, 5, 6, 8, 9]) sheet.getColumn(column).numFmt = '@'
  sheet.getColumn(3).numFmt = '0.00'
  sheet.getColumn(7).numFmt = '0'
  return workbook.xlsx.writeBuffer()
}

export async function createBankExportDownload(month: string, rows: BankExportRow[]) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Select a valid month before exporting.')
  validateBankExportRows(rows)
  const baseName = `bank-note-${month}`
  if (rows.length <= BANK_EXPORT_MAX_PAYMENTS) {
    return {
      filename: `${baseName}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: new Uint8Array(await createBankExportWorkbook(rows)),
    }
  }
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const fileCount = Math.ceil(rows.length / BANK_EXPORT_MAX_PAYMENTS)
  for (let offset = 0; offset < rows.length; offset += BANK_EXPORT_MAX_PAYMENTS) {
    const part = String(offset / BANK_EXPORT_MAX_PAYMENTS + 1).padStart(2, '0')
    const buffer = await createBankExportWorkbook(rows.slice(offset, offset + BANK_EXPORT_MAX_PAYMENTS), offset + 1)
    zip.file(`${baseName}-${part}-of-${String(fileCount).padStart(2, '0')}.xlsx`, buffer)
  }
  return { filename: `${baseName}.zip`, mimeType: 'application/zip', data: await zip.generateAsync({ type: 'uint8array' }) }
}
