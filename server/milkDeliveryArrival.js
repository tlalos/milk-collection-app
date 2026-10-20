import { assertMilkDocumentDate } from './milkDocumentDate.js'

export function prepareDeliveryArrival(existing, input) {
  const fail = (message, status = 400) => {
    const error = new Error(message)
    error.status = status
    throw error
  }
  const fields = ['greeceWeight', 'invoiceNumber', 'arrivalComments', 'status']
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !fields.includes(key))) {
    fail('Only Greece arrival details can be changed here.')
  }
  assertMilkDocumentDate(existing.deliveryDate, 'Delivery')
  if (!['AWAITING_GREECE', 'COMPLETE'].includes(existing.status)) {
    fail('Arrival details are available only after departure.', 403)
  }
  const next = { ...existing, ...input }
  if (next.status !== existing.status && !(existing.status === 'AWAITING_GREECE' && next.status === 'COMPLETE')) {
    fail('Arrival updates cannot reset the departure or completion status.')
  }
  const rawWeight = next.greeceWeight
  next.greeceWeight = rawWeight === null || rawWeight === undefined || rawWeight === ''
    ? null : Number(String(rawWeight).replace(',', '.'))
  if (next.greeceWeight !== null && (!Number.isFinite(next.greeceWeight) || next.greeceWeight < 0)) {
    fail('Weight from Greece must be a valid, non-negative number.')
  }
  if (next.greeceWeight !== null) next.greeceWeight = Math.round(next.greeceWeight * 1000) / 1000
  next.invoiceNumber = String(next.invoiceNumber || '').trim().toUpperCase()
  next.arrivalComments = String(next.arrivalComments || '').trim()
  if (next.invoiceNumber.length > 160 || next.arrivalComments.length > 1200) fail('Arrival details are too long.')
  if (next.status === 'COMPLETE' && !(next.greeceWeight > 0)) fail('Weight from Greece is required before completing the delivery.')
  if (next.status === 'COMPLETE' && !next.invoiceNumber) fail('Invoice number is required before completing the delivery.')
  return next
}
