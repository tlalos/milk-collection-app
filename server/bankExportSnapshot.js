import { bankExportIssues } from './bankExportFile.js'
import { monthlyInvoiceAmounts } from './monthlyInvoiceAmounts.js'

const code = value => String(value || '').trim().toLowerCase()
export const bankExportError = (message, status = 409) => Object.assign(new Error(message), { status })
export function validateBankExportMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw bankExportError('Select a valid export month.', 400)
  return month
}
export function validateBankExportInput(input) {
  validateBankExportMonth(input?.month)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestKey || '')) throw bankExportError('Invalid export request identifier.', 400)
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 2000) throw bankExportError('Select between 1 and 2,000 payments.', 400)
  const ids = new Set()
  for (const row of input.rows) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 400 || ids.has(row.id)) throw bankExportError('Invalid or duplicate payment row.', 400)
    ids.add(row.id)
    for (const field of ['recipientName', 'comment', 'iban', 'recipientCode']) {
      if (typeof row[field] !== 'string' || row[field].length > 240) throw bankExportError(`Invalid ${field}.`, 400)
    }
    const issues = bankExportIssues(row)
    if (issues.length || row.amount <= 0 || row.amount > 1e12) throw bankExportError(issues.join(' ') || 'Payment amount must be positive and within the supported range.', 400)
    if (!Number.isFinite(row.totalLiters) || row.totalLiters < 0) throw bankExportError('Invalid payment quantity.', 400)
  }
}

// Identity, centers, quantities and amounts come from saved server data, not browser labels.
export function buildBankExportSnapshot(input, pricingRows, producers) {
  const sourceRows = new Map(pricingRows.map(row => [row.id, row]))
  const suppliers = new Map(producers.map(row => [code(row.producerCode), row]))
  return input.rows.map(selected => {
    const source = sourceRows.get(selected.id)
    if (!source || source.month !== input.month || source.approvalReviewRequired || source.producerWarning) throw bankExportError('A selected payment is no longer available. Refresh the bank note.')
    const producer = suppliers.get(code(source.producerCode))
    const recipient = suppliers.get(code(selected.recipientCode))
    if (!producer || !recipient || !recipient.iban?.trim()) throw bankExportError('A producer or recipient bank account is unavailable. Refresh ERP references.')
    const amount = monthlyInvoiceAmounts(source.liters, source.price, source.commission, source.electricity,
      ['1','true','yes'].includes(code(producer.extra)), code(producer.vatStatusName) === 'regular', source.source === 'collector').finalResult
    if (amount === null || Math.round(amount * 100) !== Math.round(selected.amount * 100) || source.liters !== selected.totalLiters || recipient.iban.trim() !== selected.iban.trim()) {
      throw bankExportError('Payment amount, quantity or bank account changed. Refresh and review the export again.')
    }
    return {
      id: source.id, producerCode: source.producerCode, producerName: producer.producerName || source.producer,
      centers: source.center?.trim() ? [source.center.trim()] : [],
      recipientCode: recipient.producerCode, recipientName: selected.recipientName.trim(), iban: recipient.iban.trim(),
      amount: Math.round(amount * 100) / 100, totalLiters: source.liters,
      milkType: source.milkType.replace(/^MILK-/, ''), comment: selected.comment.trim(),
    }
  })
}
