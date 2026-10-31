import { useCanOperate } from './useCanOperate'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Download, RefreshCw, X, Ban } from 'lucide-react'
import { bankExportRequest, downloadSavedBankExport, type BankExportBatch, type BankExportHistory } from '../bankExportHistory'
import './BankExportHistoryDialog.css'

export type BankExportHistoryHandle = { open: (month: string, batchId?: string) => void }
const money = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const date = (value: string) => new Date(value).toLocaleString()
export const BankExportHistoryDialog = forwardRef<BankExportHistoryHandle, { isAdmin: boolean; onChanged: () => void }>(function BankExportHistoryDialog({ isAdmin, onChanged }, ref) {
  const canOperate = useCanOperate('bank_note')
  const dialog = useRef<HTMLDialogElement>(null)
  const sequence = useRef(0)
  const [month, setMonth] = useState('')
  const [batches, setBatches] = useState<BankExportBatch[]>([])
  const [batch, setBatch] = useState<BankExportBatch | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [center, setCenter] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  async function load(selectedMonth: string, id?: string) {
    const current = ++sequence.current
    setLoading(true); setError(''); setBatch(null); setSearch(''); setCenter(''); setCancelling(false)
    try {
      if (id) {
        const detail = await bankExportRequest<BankExportBatch>(`/${id}`)
        if (current === sequence.current) setBatch(detail)
      } else {
        const result = await bankExportRequest<BankExportHistory>(`?month=${encodeURIComponent(selectedMonth)}`)
        if (current === sequence.current) setBatches(result.batches)
      }
    } catch (cause) { if (current === sequence.current) setError((cause as Error).message) }
    finally { if (current === sequence.current) setLoading(false) }
  }
  useImperativeHandle(ref, () => ({ open(selectedMonth, id) {
    if (busyRef.current) return
    setMonth(selectedMonth); setBatches([]); dialog.current?.showModal(); void load(selectedMonth, id)
  } }))
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await action() } catch (cause) { setError((cause as Error).message) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const centers = [...new Set((batch?.lines || []).flatMap(row => row.centers || []))].sort()
  const lines = (batch?.lines || []).filter(row => (!center || row.centers?.includes(center)) &&
    `${row.producerName} ${row.producerCode} ${row.recipientName} ${row.iban} ${row.comment}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <dialog ref={dialog} className={`bank-history-dialog${batch ? '' : ' bank-history-dialog-list'}`} aria-labelledby="bank-history-title" onCancel={event => { if (busy) event.preventDefault() }}>
    <header className="bank-history-header">
      {batch && <button type="button" aria-label="Back to exports" title="Back to exports" disabled={busy} onClick={() => void load(month)}><ArrowLeft size={18} /></button>}
      <h2 id="bank-history-title">{batch ? `Export ${batch.exportNumber} / ${batch.month}` : 'Export history'}</h2>
      <button type="button" aria-label="Close export history" title="Close" disabled={busy} onClick={() => dialog.current?.close()}><X size={18} /></button>
    </header>
    <div className="bank-history-body">
      {!batch && <div className="bank-history-tools"><label>Month<input type="month" value={month} disabled={busy} onChange={event => { const value = event.target.value; setMonth(value); setBatches([]); if (value) void load(value) }} /></label><button type="button" aria-label="Refresh export history" title="Refresh" disabled={busy || loading || !month} onClick={() => void load(month)}><RefreshCw size={18} /></button></div>}
      {error && <p role="alert" className="bank-history-error">{error}</p>}
      {loading ? <p role="status">Loading exports...</p> : batch ? <>
        <div className="bank-history-meta"><strong>{batch.status === 'CANCELLED' ? 'Cancelled' : 'Exported'}</strong><span>{date(batch.createdAt)} by {batch.createdBy}</span><span>{batch.paymentCount} payments</span><strong>{money(batch.totalAmount)} {batch.currency}</strong></div>
        {batch.status === 'CANCELLED' && <p className="bank-history-error">Cancelled by {batch.cancelledBy} on {date(batch.cancelledAt!)}: {batch.cancelReason}</p>}
        <div className="bank-history-tools">
          <label>Center<select aria-label="Center" value={center} onChange={event => setCenter(event.target.value)}><option value="">All centers</option>{centers.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Search<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Producer, recipient, IBAN..." /></label>
          <button type="button" disabled={!canOperate || (busy)} onClick={() => void run(() => downloadSavedBankExport(batch))}><Download size={17} />Original file</button>
        </div>
        <div className="bank-history-table"><table><thead><tr><th>#</th><th>Producer</th><th>Center</th><th>Recipient</th><th>IBAN</th><th>Liters</th><th>Amount (RON)</th><th>Comment</th></tr></thead>
          <tbody>{lines.map(row => <tr key={row.lineNumber}><td>{row.lineNumber}</td><td>{row.producerName}<small>{row.producerCode} / {row.milkType}</small></td><td>{row.centers?.join(', ') || '-'}</td><td>{row.recipientName}<small>{row.recipientCode}</small></td><td>{row.iban}</td><td className="number">{row.totalLiters.toLocaleString('en-US')}</td><td className="number">{money(row.amount || 0)}</td><td>{row.comment}</td></tr>)}</tbody>
          <tfoot><tr><th colSpan={5}>{lines.length} payments shown</th><td className="number">{lines.reduce((sum,row)=>sum+row.totalLiters,0).toLocaleString('en-US')}</td><td className="number">{money(lines.reduce((sum,row)=>sum+(row.amount || 0),0))}</td><td /></tr></tfoot>
        </table></div>
        {isAdmin && batch.status !== 'CANCELLED' && <div className="bank-history-cancel">
          {!cancelling ? <button type="button" disabled={busy} onClick={() => { setCancelling(true); setReason(''); setConfirmed(false) }}><Ban size={17} />Cancel export</button> : <>
            <label>Cancellation reason<textarea rows={2} maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
            <label className="bank-history-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />I verified these payments will not be processed by the bank. Cancellation makes them available for export again.</label>
            <div className="bank-history-tools"><button type="button" disabled={busy} onClick={() => setCancelling(false)}>Keep export</button><button type="button" disabled={busy || !reason.trim() || !confirmed} onClick={() => void run(async () => {
              const result = await bankExportRequest<BankExportBatch>(`/${batch.batchId}/cancel`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reason}) })
              setBatch(result); setCancelling(false); onChanged()
            })}>Confirm cancellation</button></div>
          </>}
        </div>}
      </> : <div className="bank-history-table bank-history-list"><table>
        <colgroup><col style={{width:'24%'}} /><col style={{width:'22%'}} /><col style={{width:'30%'}} /><col style={{width:'24%'}} /></colgroup>
        <thead><tr><th>Export</th><th>Payments</th><th>Total (RON)</th><th>Status</th></tr></thead><tbody>
        {batches.map(item => <tr key={item.batchId}><td><button className="bank-history-export" type="button" onClick={() => void load(month,item.batchId)}>Export {item.exportNumber}<ChevronRight size={14} aria-hidden="true" /></button></td><td>{item.paymentCount}</td><td className="number">{money(item.totalAmount)}</td><td><span className={`bank-history-status ${item.status === 'CANCELLED' ? 'cancelled' : 'exported'}`}>{item.status === 'CANCELLED' ? 'Cancelled' : 'Exported'}</span></td></tr>)}
        {!batches.length && <tr><td colSpan={4} className="bank-history-empty">No saved exports for this month.</td></tr>}
      </tbody></table></div>}
    </div>
  </dialog>
})
