interface InvoiceSource {
  producerCode: string
  producerWarning?: string | null
  duplicateProducer?: boolean
  missingLiters?: boolean
  approvalReviewRequired?: boolean
  source?: 'journal' | 'aviz'
  readyForPricing: boolean
  reconciliationStatus: string
  reconciliationDifferenceLiters: number | null
}

export type InvoiceSendFilter = 'all' | 'not_sent' | 'sent' | 'verification' | 'sending'

export function matchesInvoiceSendFilter(status: string | undefined, filter: InvoiceSendFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'not_sent') return status === undefined || status === 'DRAFT'
  if (filter === 'sent') return status === 'SENT'
  if (filter === 'verification') return status === 'UNCONFIRMED'
  return status === 'SENDING'
}

export function monthlyInvoiceSeries(bool2: string | null | undefined): number | null {
  if (bool2?.trim() === '0') return 5106
  if (bool2?.trim() === '1') return 5105
  return null
}

export function monthlyInvoiceBlockReason(row: InvoiceSource, finalAmount: number | null, hasErpProducer: boolean): string | null {
  if (row.producerWarning) return row.producerWarning
  if (!/^p\S+$/i.test(row.producerCode) || !hasErpProducer) return 'No ERP match'
  if (row.duplicateProducer) return 'Duplicate'
  if (row.approvalReviewRequired) return 'Approval needs review'
  if (row.missingLiters) return 'Missing liters'
  if (row.source === 'aviz') {
    if (!row.readyForPricing) return 'Approval needs review'
  } else {
    if (row.reconciliationStatus === 'missing_aviz') return 'Missing aviz'
    if (row.reconciliationStatus === 'missing_monthly') return 'No journal'
    if (row.reconciliationDifferenceLiters === null || !Number.isFinite(row.reconciliationDifferenceLiters)) return 'Comparison unavailable'
    if (Math.abs(row.reconciliationDifferenceLiters) > 10) return 'Difference exceeds 10 L'
    if (!row.readyForPricing) return 'Unresolved reconciliation problem'
  }
  if (finalAmount === null || !Number.isFinite(finalAmount)) return 'No final result'
  return null
}
