import { invoiceIdentity } from './monthlyInvoiceStore.js'
import { buildInvoicePreview } from './monthlyInvoiceSend.js'

export function validateInvoiceBatch(month, selections) {
  if (!Array.isArray(selections) || !selections.length || selections.length > 500) throw new Error('Select between 1 and 500 invoices.')
  const seen = new Set()
  return selections.map(selection => {
    const { producerCode, milkType, invoiceDate } = selection || {}
    const identity = invoiceIdentity(month, producerCode, invoiceDate)
    if (!['MILK-COW', 'MILK-BUFF', 'MILK-SHEEP', 'MILK-GOAT'].includes(milkType)) throw new Error('Invalid invoice milk type.')
    const key = `${identity.producerCode}:${milkType}`
    if (seen.has(key)) throw new Error('An invoice was selected more than once.')
    seen.add(key)
    return { month, producerCode: identity.producerCode, milkType, invoiceDate }
  })
}

// Shared by single-send validation and batch preview; the context is server-loaded data.
export function prepareInvoiceFromContext({ month, producerCode, milkType, invoiceDate }, { erp, rows, invoices }) {
  const identity = invoiceIdentity(month, producerCode, invoiceDate)
  const suppliers = erp.suppliers.filter(supplier => String(supplier.sup_code || '').trim().toLowerCase() === identity.producerCode)
  if (suppliers.length !== 1) throw new Error('Expected one exact ERP supplier match.')
  const row = rows.find(row => row.month === month && row.producerCode.trim().toLowerCase() === identity.producerCode && row.milkType === milkType)
  const matching = invoices.filter(invoice => invoice.monthKey === month && invoice.producerCode === identity.producerCode)
  if (matching.some(invoice => (!invoice.milkType || invoice.milkType === milkType) && invoice.status !== 'DRAFT')) throw new Error('Invoice already submitted. Check its ERP status before retrying.')
  const saved = matching.find(invoice => invoice.milkType === milkType)
  const legacy = matching.find(invoice => !invoice.milkType)
  const [year, monthNumber] = month.split('-').map(Number)
  const expectedDate = saved?.invoiceDate || legacy?.invoiceDate || `${month}-${new Date(year, monthNumber, 0).getDate()}`
  if (expectedDate !== invoiceDate) throw new Error('Invoice date changed. Refresh and preview again.')
  return { erp, saved, preview: buildInvoicePreview(row, suppliers[0], invoiceDate, erp.username, erp.params) }
}

export function previewInvoiceBatch(selections, context) {
  return selections.map(selection => {
    try {
      const { snapshot, fingerprint } = prepareInvoiceFromContext(selection, context).preview
      return { selection, snapshot, fingerprint }
    } catch (error) { return { selection, error: error.message } }
  })
}
