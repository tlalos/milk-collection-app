import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { appPath } from '../ocrPaths'
import { displayInvoiceDate } from '../invoiceDateFormat'

interface History {
  invoice: { invoiceId: string; monthKey: string; producerCode: string; milkType: string; invoiceDate: string; status: string; series: number | null; erpId: string | null; erpNumber: string | null }
  attempts: Array<{ attemptId: string; status: string; startedAt: string; finishedAt: string | null; attemptedBy: string; error: string | null; verifiedAbsentAt: string | null; verifiedAbsentBy: string | null; outcome: string | null; reason: string | null; erpId: string | null; erpNumber: string | null; resolvedBy: string | null; resolvedAt: string | null }>
  canResolve: boolean
}

export interface InvoiceResolutionDialogHandle { open(invoiceId: string, producer: string): void }

export const InvoiceResolutionDialog = forwardRef<InvoiceResolutionDialogHandle, {
  onResolved(month: string, message: string): Promise<void>
}>(function InvoiceResolutionDialog({ onResolved }, ref) {
  const dialog = useRef<HTMLDialogElement>(null)
  const busyRef = useRef(false)
  const [history, setHistory] = useState<History | null>(null)
  const [producer, setProducer] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<'FOUND' | 'ABSENT'>('FOUND')
  const [reason, setReason] = useState('')
  const [erpId, setErpId] = useState('')
  const [erpNumber, setErpNumber] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  useImperativeHandle(ref, () => ({ open(invoiceId, name) {
    if (busyRef.current) return
    busyRef.current = true
    setHistory(null); setProducer(name); setLoading(true); setError(''); setOutcome('FOUND')
    setReason(''); setErpId(''); setErpNumber(''); setConfirmed(false)
    dialog.current?.showModal()
    void (async () => {
      try {
        const response = await fetch(appPath(`/api/month-closure/invoices/${encodeURIComponent(invoiceId)}/history`), { signal: AbortSignal.timeout(30000) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load invoice history.')
        setHistory(data)
      } catch (error) { setError((error as Error).message) }
      finally { busyRef.current = false; setLoading(false) }
    })()
  } }), [])

  const pending = history?.attempts.filter(attempt => attempt.status === 'UNCONFIRMED' && attempt.finishedAt && !attempt.verifiedAbsentAt && !attempt.outcome) || []
  const canResolve = history?.canResolve && history.invoice.status === 'UNCONFIRMED' && !history.invoice.erpId && pending.length === 1
  const canSubmit = canResolve && confirmed && reason.trim() && (outcome === 'ABSENT' || erpId.trim()) && !saving

  async function resolve() {
    if (!canSubmit || !history || busyRef.current) return
    busyRef.current = true; setSaving(true); setError('')
    try {
      const response = await fetch(appPath(`/api/month-closure/invoices/${encodeURIComponent(history.invoice.invoiceId)}/resolve`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ attemptId: pending[0].attemptId, outcome, reason, erpId, erpNumber, confirmed }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not resolve invoice status.')
      await onResolved(history.invoice.monthKey, result.status === 'SENT'
        ? `Invoice marked as sent. ERP ID: ${result.erpId}. It remains locked.`
        : 'Invoice unlocked for correction and review. Nothing was sent to ERP.')
      dialog.current?.close()
    } catch (error) {
      setError(`${(error as Error).message} Close and reopen the history to refresh its status before trying again.`)
      setConfirmed(false)
      // A timed-out response may already have committed. Require a fresh history before another action.
      setHistory(current => current ? { ...current, canResolve: false } : null)
    } finally { busyRef.current = false; setSaving(false) }
  }

  return <dialog ref={dialog} className="month-closure-date-dialog invoice-resolution-dialog" aria-labelledby="invoice-resolution-title"
    onCancel={event => { if (saving || loading) event.preventDefault() }}>
    <form onSubmit={event => { event.preventDefault(); void resolve() }}>
      <h2 id="invoice-resolution-title">{canResolve ? 'Resolve ERP status' : 'ERP invoice history'}</h2>
      <strong>{producer}</strong>
      {loading && <p role="status">Loading invoice history...</p>}
      {error && <p className="month-closure-date-error" role="alert">{error}</p>}
      {history && <>
        <p>{history.invoice.producerCode} · {history.invoice.milkType} · {displayInvoiceDate(history.invoice.invoiceDate)} · Series {history.invoice.series ?? '-'} · {history.invoice.status}</p>
        {history.invoice.erpId && <p>ERP ID: {history.invoice.erpId}{history.invoice.erpNumber ? ` · Number: ${history.invoice.erpNumber}` : ''}</p>}
        {history.invoice.status === 'SENT' && <p>This invoice is already sent and cannot be unlocked here.</p>}
        {history.invoice.status === 'UNCONFIRMED' && !history.canResolve && !error && <p>Only users with the Resolve unconfirmed ERP invoices permission can resolve this invoice.</p>}
        {history.invoice.status === 'SENDING' && <p>Sending is still pending. Verify its status before taking any further action.</p>}
        {history.invoice.status === 'UNCONFIRMED' && history.canResolve && !canResolve && <p>This invoice needs administrator review before it can be resolved.</p>}
        <details className="invoice-resolution-history" open>
          <summary>Sending and resolution history ({history.attempts.length})</summary>
          <ol>{history.attempts.map(attempt => <li key={attempt.attemptId}>
            <strong>{attempt.status}</strong> · {new Date(attempt.startedAt).toLocaleString('en-GB')} · {attempt.attemptedBy}
            {attempt.error && <p>{attempt.error}</p>}
            {attempt.outcome && <p><strong>{attempt.outcome === 'FOUND' ? 'Found in ERP' : 'Verified absent; unlocked'}</strong> · {attempt.resolvedBy} · {new Date(attempt.resolvedAt!).toLocaleString('en-GB')}<br />{attempt.reason}{attempt.erpId ? ` · ERP ID: ${attempt.erpId}` : ''}{attempt.erpNumber ? ` · Number: ${attempt.erpNumber}` : ''}</p>}
            {!attempt.outcome && attempt.verifiedAbsentAt && <p>Verified absent by {attempt.verifiedAbsentBy} · {new Date(attempt.verifiedAbsentAt).toLocaleString('en-GB')}</p>}
          </li>)}</ol>
        </details>
        {canResolve && <fieldset disabled={saving} className="invoice-resolution-fields">
          <legend>ERP verification</legend>
          <label><input type="radio" name="erp-resolution" checked={outcome === 'FOUND'} onChange={() => { setOutcome('FOUND'); setConfirmed(false) }} /> Found in ERP</label>
          <label><input type="radio" name="erp-resolution" checked={outcome === 'ABSENT'} onChange={() => { setOutcome('ABSENT'); setConfirmed(false) }} /> Not found in ERP</label>
          {outcome === 'FOUND' ? <>
            <label>ERP document ID<input required maxLength={120} value={erpId} onChange={event => { setErpId(event.target.value); setConfirmed(false) }} /></label>
            <label>ERP document number (optional)<input maxLength={120} value={erpNumber} onChange={event => setErpNumber(event.target.value)} /></label>
          </> : <p>Unlock only after checking ERP. Retrying an invoice that already exists can create a duplicate.</p>}
          <label>Verification reason<textarea required maxLength={1000} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{outcome === 'FOUND'
            ? 'I checked ERP and this document belongs to this invoice.'
            : 'I checked ERP and confirmed this invoice does not exist.'}</label>
        </fieldset>}
      </>}
      <div className="month-closure-bulk-actions">
        <button type="button" className="month-closure-cancel-bulk" disabled={saving || loading} onClick={() => dialog.current?.close()}>Close</button>
        {canResolve && <button type="submit" className="month-closure-apply-bulk" disabled={!canSubmit}>{saving ? 'Saving...' : outcome === 'FOUND' ? 'Mark as sent' : 'Unlock for review'}</button>}
      </div>
    </form>
  </dialog>
})
