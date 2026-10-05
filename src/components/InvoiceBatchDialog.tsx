import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { appPath } from '../ocrPaths'
import { displayInvoiceDate } from '../invoiceDateFormat'
import { runInvoiceBatch, type BatchInvoice, type BatchResult, type BatchSelection } from '../invoiceBatch'
import { ocrConnectionSettingsStore } from '../store/ocrConnectionSettingsStore'

export interface InvoiceBatchDialogHandle { open(selections: BatchSelection[]): void }

const amount = (value: number | undefined) => value === undefined ? '-' : value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const InvoiceBatchDialog = forwardRef<InvoiceBatchDialogHandle, { onFinished(month: string): Promise<void> }>(function InvoiceBatchDialog({ onFinished }, ref) {
  const dialog = useRef<HTMLDialogElement>(null)
  const busy = useRef(false)
  const stop = useRef(false)
  const previewAbort = useRef<AbortController | null>(null)
  const [phase, setPhase] = useState<'loading' | 'review' | 'sending' | 'done'>('loading')
  const [invoices, setInvoices] = useState<BatchInvoice[]>([])
  const [results, setResults] = useState<BatchResult[]>([])
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState(false)

  useImperativeHandle(ref, () => ({ open(selections) {
    if (busy.current || !selections.length) return
    busy.current = true
    setPhase('loading'); setInvoices([]); setResults([]); setError(''); setStopping(false); stop.current = false
    const controller = new AbortController()
    previewAbort.current = controller
    dialog.current?.showModal()
    void (async () => {
      try {
        const connection = await ocrConnectionSettingsStore.resolve()
        if (controller.signal.aborted) return
        const response = await fetch(appPath('/api/month-closure/invoice-batch-preview'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]),
          body: JSON.stringify({ month: selections[0].month, invoices: selections, connection }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not prepare selected invoices.')
        if (!Array.isArray(data.invoices) || data.invoices.length !== selections.length) throw new Error('Incomplete invoice preview. Refresh and try again.')
        setInvoices(data.invoices)
        setResults(data.invoices.map((invoice: BatchInvoice) => ({ status: invoice.error ? 'blocked' : 'ready', error: invoice.error })))
      } catch (error) { if (!controller.signal.aborted) setError((error as Error).message) }
      finally { busy.current = false; setPhase('review') }
    })()
  } }), [])

  const ready = invoices.filter(invoice => !invoice.error && invoice.snapshot && invoice.fingerprint)
  const total = ready.reduce((sum, invoice) => sum + invoice.snapshot!.total, 0)
  const sentCount = results.filter(result => result.status === 'sent').length
  const blockedCount = results.filter(result => result.status === 'blocked').length
  const notSentCount = results.filter(result => result.status === 'not_sent').length

  async function send() {
    if (busy.current || phase !== 'review' || !ready.length) return
    busy.current = true; setPhase('sending'); setError('')
    const warnOnLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warnOnLeave)
    try {
      const connection = await ocrConnectionSettingsStore.resolve()
      const completed = await runInvoiceBatch(invoices, async invoice => {
        const response = await fetch(appPath('/api/month-closure/invoice-send'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(300000),
          body: JSON.stringify({ ...invoice.selection, fingerprint: invoice.fingerprint, connection, confirmed: true }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Send could not be confirmed. Verify ERP before retrying.')
        return data
      }, setResults, () => stop.current)
      if (completed.some(result => result.status === 'failed')) setError('Batch stopped. Refresh the invoice status and verify ERP for the failed invoice before retrying. No later invoices were sent.')
    } catch (error) {
      setError((error as Error).message)
      setResults(current => current.map(result => result.status === 'ready' ? { status: 'not_sent' } : result))
    } finally {
      try { await onFinished(invoices[0].selection.month) }
      finally { setPhase('done'); busy.current = false; window.removeEventListener('beforeunload', warnOnLeave) }
    }
  }

  function close() {
    if (phase === 'sending') return
    previewAbort.current?.abort()
    dialog.current?.close()
  }

  return <dialog ref={dialog} className="month-closure-date-dialog invoice-batch-dialog" aria-labelledby="invoice-batch-title"
    onCancel={event => { if (phase === 'sending') event.preventDefault(); else previewAbort.current?.abort() }}>
    <div className="invoice-batch-content">
      <h2 id="invoice-batch-title">{phase === 'done' ? 'Batch results' : phase === 'sending' ? 'Sending invoices' : 'Review selected invoices'}</h2>
      {phase === 'loading' ? <p role="status">Preparing invoices...</p> : <>
        <p role="status">{phase === 'review' ? `${ready.length} ready · ${blockedCount} blocked · Total ${amount(total)}`
          : `${sentCount} sent · ${blockedCount} blocked${phase === 'done' ? ` · ${notSentCount} not sent` : ` · ${ready.length - sentCount} remaining`}`}</p>
        {phase === 'review' && <p>Each ready row creates a separate ERP invoice. Blocked rows will not be sent.</p>}
        {phase === 'sending' && <p>{stopping ? 'Stopping after the current invoice finishes...' : 'Keep this page open. Sending stops if an invoice fails.'}</p>}
      </>}
      {error && <p className="month-closure-date-error" role="alert">{error}</p>}
      {invoices.length > 0 && <div className="invoice-batch-table-wrap"><table>
        <thead><tr><th>Producer</th><th>Milk</th><th>Date</th><th>Series</th><th>Qty L</th><th>Price</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>{invoices.map((invoice, index) => <tr key={`${invoice.selection.producerCode}:${invoice.selection.milkType}`}>
          <td>{invoice.snapshot?.producerName || invoice.selection.producerCode}<small>{invoice.selection.producerCode}</small></td>
          <td>{invoice.selection.milkType.replace('MILK-', '')}</td>
          <td>{displayInvoiceDate(invoice.selection.invoiceDate)}</td><td>{invoice.snapshot?.series ?? '-'}</td>
          <td>{invoice.snapshot?.liters ?? '-'}</td><td>{amount(invoice.snapshot?.price)}</td><td>{amount(invoice.snapshot?.subtotal)}</td><td>{amount(invoice.snapshot?.tax)}</td><td>{amount(invoice.snapshot?.total)}</td>
          <td className={`invoice-batch-status ${results[index]?.status}`}>
            {({ ready: 'Ready', blocked: 'Blocked', sending: 'Sending...', sent: 'Sent', failed: 'Check status', not_sent: 'Not sent' })[results[index]?.status || 'ready']}
            {results[index]?.erpId && <small>ERP ID: {results[index].erpId}</small>}
            {results[index]?.error && <small>{results[index].error}</small>}
          </td>
        </tr>)}</tbody>
      </table></div>}
      <div className="month-closure-bulk-actions">
        {phase !== 'sending' && <button type="button" className="month-closure-cancel-bulk" onClick={close}>{phase === 'done' ? 'Close' : 'Cancel'}</button>}
        {phase === 'review' && <button type="button" className="month-closure-apply-bulk" disabled={!ready.length} onClick={() => void send()}>Confirm send ({ready.length})</button>}
        {phase === 'sending' && <button type="button" className="month-closure-cancel-bulk" disabled={stopping} onClick={() => { stop.current = true; setStopping(true) }}>Stop after current</button>}
      </div>
    </div>
  </dialog>
})
