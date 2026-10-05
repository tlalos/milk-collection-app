export interface BatchSelection { month: string; producerCode: string; milkType: string; invoiceDate: string }
export interface BatchInvoice {
  selection: BatchSelection
  fingerprint?: string
  snapshot?: { producerName: string; series: number; liters: number; price: number; subtotal: number; tax: number; total: number }
  error?: string
}
export type BatchResult = { status: 'ready' | 'blocked' | 'sending' | 'sent' | 'failed' | 'not_sent'; erpId?: string; error?: string }

export async function runInvoiceBatch(
  invoices: BatchInvoice[],
  send: (invoice: BatchInvoice) => Promise<{ erpId: string }>,
  update: (results: BatchResult[]) => void,
  shouldStop: () => boolean,
): Promise<BatchResult[]> {
  const results: BatchResult[] = invoices.map(invoice => ({ status: invoice.error || !invoice.snapshot || !invoice.fingerprint ? 'blocked' : 'ready', error: invoice.error }))
  for (let i = 0; i < invoices.length; i++) {
    if (shouldStop()) break
    if (results[i].status !== 'ready') continue
    results[i] = { status: 'sending' }
    update([...results])
    try {
      const result = await send(invoices[i])
      if (!result?.erpId || String(result.erpId) === '0') throw new Error('No ERP document ID was confirmed. Verify ERP before retrying.')
      results[i] = { status: 'sent', erpId: String(result.erpId) }
    } catch (error) {
      results[i] = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
      break
    }
    update([...results])
  }
  const final = results.map(result => result.status === 'ready' ? { status: 'not_sent' as const } : result)
  update(final)
  return final
}
