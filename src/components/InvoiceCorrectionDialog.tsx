import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { appPath } from '../ocrPaths'
import './InvoiceCorrectionDialog.css'

interface Pricing { producerCode: string; milkType: string; price?: number | null; commission?: number | null; electricity?: number | null }
interface Context {
  invoice: { invoiceId: string; monthKey: string; milkType: string; producerCode: string; erpId: string; erpNumber?: string }
  version: string; current?: Pricing; rows: Pricing[]
  producers: Array<{ producerCode: string; producerName: string; centerName: string }>
  journals: Array<{ id: string; sourceFile: string; center: string; rows: Array<{ rowNumber: number; producer: string; producerCode: string; liters: number }> }>
}
interface Preview { producer: string; producerCode: string; previousProducerCode: string; liters: number; subtotal: number; affectedRows: Array<{ producer: string; producerCode: string; liters: number }> }
export interface InvoiceCorrectionDialogHandle { open(invoiceId: string): void }

export const InvoiceCorrectionDialog = forwardRef<InvoiceCorrectionDialogHandle, { onCorrected(month: string): Promise<void> }>(function InvoiceCorrectionDialog({ onCorrected }, ref) {
  const dialog = useRef<HTMLDialogElement>(null)
  const busyRef = useRef(false)
  const [context, setContext] = useState<Context | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [producerCode, setProducerCode] = useState('')
  const [amounts, setAmounts] = useState({ price: '', commission: '', electricity: '' })
  const [matches, setMatches] = useState<Record<string, { jobId: string; rowNumber: number; producerCode: string }>>({})
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [preview, setPreview] = useState<{ preview: Preview; previewToken: string } | null>(null)
  const [finished, setFinished] = useState(false)
  function loadAmounts(row?: Pricing) {
    setAmounts({ price: row?.price == null ? '' : String(row.price), commission: String(row?.commission ?? 0), electricity: String(row?.electricity ?? 0) })
  }
  useImperativeHandle(ref, () => ({ open(invoiceId) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setContext(null); setMatches({}); setReason(''); setConfirmed(false); setPreview(null); setFinished(false)
    dialog.current?.showModal()
    void (async () => {
      try {
        const response = await fetch(appPath(`/api/month-closure/invoices/${encodeURIComponent(invoiceId)}/correction`), { signal: AbortSignal.timeout(30000) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load correction.')
        setContext(data); setProducerCode(data.invoice.producerCode); loadAmounts(data.current)
      } catch (error) { setError((error as Error).message) }
      finally { busyRef.current = false; setBusy(false) }
    })()
  } }), [])
  async function submit() {
    if (!context || busyRef.current || finished) return
    const applying = Boolean(preview)
    busyRef.current = true; setBusy(true); setError('')
    try {
      const response = await fetch(appPath(`/api/month-closure/invoices/${encodeURIComponent(context.invoice.invoiceId)}/${applying ? 'correction' : 'correction-preview'}`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ version: context.version, producerCode, matches: Object.values(matches), reason, confirmed,
          price: Number(amounts.price), commission: Number(amounts.commission), electricity: Number(amounts.electricity), previewToken: preview?.previewToken }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save the correction.')
      if (applying) { setFinished(true); await onCorrected(context.invoice.monthKey); dialog.current?.close() }
      else setPreview(result)
    } catch (error) {
      setError(`${(error as Error).message}${applying ? ' Close and reopen to check the saved state before trying again.' : ''}`)
      if (applying) setFinished(true)
    } finally { busyRef.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="month-closure-date-dialog invoice-correction-dialog" aria-labelledby="invoice-correction-title" onCancel={event => { if (busy) event.preventDefault() }}>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <h2 id="invoice-correction-title">Correct after ERP change</h2>
      {error && <p role="alert" className="month-closure-date-error">{error}</p>}
      {busy && !context && <p role="status">Loading invoice...</p>}
      {context && <>
        <p className="invoice-correction-reference">{context.invoice.monthKey} · {context.invoice.milkType} · ERP {context.invoice.erpNumber || context.invoice.erpId} · <strong>Sent</strong></p>
        <p className="invoice-correction-warning">Local correction only. The existing ERP invoice will not be changed or sent again.</p>
        {!preview ? <fieldset disabled={busy || finished}>
          {context.journals.map(job => <section key={job.id}>
            <h3>{job.center}</h3><p className="invoice-correction-file">{job.sourceFile}</p>
            <div className="invoice-correction-journal">{job.rows.map(row => <label key={row.rowNumber}>
              <span>#{row.rowNumber} · {row.producer} · {row.liters.toLocaleString()} L</span>
              <select aria-label={`Producer for journal row ${row.rowNumber}`} value={matches[`${job.id}:${row.rowNumber}`]?.producerCode ?? row.producerCode} onChange={event => {
                const value = event.target.value
                setMatches(current => { const next = { ...current }; const key = `${job.id}:${row.rowNumber}`; if (value === row.producerCode) delete next[key]; else next[key] = { jobId: job.id, rowNumber: row.rowNumber, producerCode: value }; return next })
              }}>
                <option value={row.producerCode}>{row.producer}{row.producerCode ? ` [${row.producerCode}]` : ' (unmatched)'}</option>
                {context.producers.filter(p => p.producerCode !== row.producerCode && p.centerName?.trim().toUpperCase() === job.center?.trim().toUpperCase()).map(p => <option key={p.producerCode} value={p.producerCode}>{p.producerName} [{p.producerCode}]</option>)}
              </select>
            </label>)}</div>
          </section>)}
          <label>Producer on the corrected ERP invoice
            <select required value={producerCode} onChange={event => {
              setProducerCode(event.target.value)
              loadAmounts(context.rows.find(row => row.producerCode.toLowerCase() === event.target.value.toLowerCase() && row.milkType === context.invoice.milkType))
            }}>
              {context.producers.map(p => <option key={p.producerCode} value={p.producerCode}>{p.producerName} [{p.producerCode}]</option>)}
            </select>
          </label>
          <div className="invoice-correction-amounts">{(['price', 'commission', 'electricity'] as const).map(field => <label key={field}>{field[0].toUpperCase() + field.slice(1)}
            <input aria-label={`Corrected ${field}`} required type="number" min="0" step="0.0001" value={amounts[field]} onChange={event => setAmounts(current => ({ ...current, [field]: event.target.value }))} />
          </label>)}</div>
          <label>Reason<textarea required maxLength={1000} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <label className="invoice-correction-confirm"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />The existing invoice was corrected in ERP. These local details must match it; do not send again.</label>
        </fieldset> : <section className="invoice-correction-preview">
          <h3>{preview.preview.producer}</h3><p>{preview.preview.previousProducerCode} → {preview.preview.producerCode}</p>
          <p><strong>{preview.preview.liters.toLocaleString()} L</strong> · Subtotal {preview.preview.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p>Price {amounts.price} · Commission {amounts.commission} · Electricity {amounts.electricity}</p>
          <h3>Affected producers</h3>
          {preview.preview.affectedRows.map(row => <p key={row.producerCode}>{row.producer} [{row.producerCode}]: {row.liters.toLocaleString()} L</p>)}
          <p>Only the selected invoice producer's pricing is updated. Other producers keep their existing pricing.</p><p>Reason: {reason}</p>
        </section>}
      </>}
      <div className="month-closure-bulk-actions">
        <button type="button" className="month-closure-cancel-bulk" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
        {preview && <button type="button" className="month-closure-cancel-bulk" disabled={busy || finished} onClick={() => setPreview(null)}>Back</button>}
        {context && <button type="submit" className="month-closure-apply-bulk" disabled={busy || finished || !confirmed}>{busy ? 'Saving...' : preview ? 'Finish correction' : 'Review correction'}</button>}
      </div>
    </form>
  </dialog>
})
