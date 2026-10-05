import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { BANK_PAYER_IBAN, BANK_EXPORT_MAX_PAYMENTS, bankExportIssues, createBankExportDownload, type BankExportRow } from '../bankNoteExport'

export type BankExportDialogHandle = { open: (month: string, rows: BankExportRow[]) => void }
export const BankExportDialog = forwardRef<BankExportDialogHandle, {
  onExported: (month: string, rows: BankExportRow[]) => void
}>(function BankExportDialog({ onExported }, ref) {
  const dialog = useRef<HTMLDialogElement>(null)
  const busyRef = useRef(false)
  const [month, setMonth] = useState('')
  const [rows, setRows] = useState<BankExportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useImperativeHandle(ref, () => ({ open(selectedMonth, selectedRows) {
    if (busyRef.current) return
    setMonth(selectedMonth)
    setRows(selectedRows)
    setError('')
    dialog.current?.showModal()
  } }), [])
  const invalidCount = rows.filter(row => bankExportIssues(row).length).length
  const fileCount = Math.ceil(rows.length / BANK_EXPORT_MAX_PAYMENTS)
  function edit(id: string, field: 'recipientName' | 'comment', value: string) {
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value } : row))
  }
  async function download() {
    if (busyRef.current || invalidCount || !rows.length) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const download = await createBankExportDownload(month, rows)
      const blob = new Blob([new Uint8Array(download.data)], { type: download.mimeType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = download.filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      onExported(month, rows)
      dialog.current?.close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Excel export failed. No payments were marked exported.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  return <dialog ref={dialog} className="month-closure-date-dialog bank-export-dialog" aria-labelledby="bank-export-title" onCancel={event => { if (busyRef.current) event.preventDefault() }}>
    <div className="bank-export-content">
      <h2 id="bank-export-title">Review bank export</h2>
      <p>{month} · {rows.length} {rows.length === 1 ? 'payment' : 'payments'} · {rows.reduce((sum, row) => sum + (row.amount ?? 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei</p>
      <p>Payer IBAN: {BANK_PAYER_IBAN}</p>
      <p>{fileCount} Excel {fileCount === 1 ? 'file' : 'files in one ZIP'} · Maximum 99 payments + header per file</p>
      {invalidCount > 0 && <p role="alert">{invalidCount} {invalidCount === 1 ? 'row needs' : 'rows need'} correction before export.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="bank-export-table-wrap"><table>
        <thead><tr><th>Producer</th><th>Recipient IBAN</th><th>Amount (lei)</th><th>Recipient name</th><th>Comment</th></tr></thead>
        <tbody>{rows.map((row, index) => {
          const issues = bankExportIssues(row)
          return <tr key={row.id}>
            <td>{row.producerName}<small>#{index + 1} · {row.milkType}</small></td>
            <td>{row.iban}</td><td>{row.amount?.toFixed(2)}</td>
            <td><input aria-label={`Recipient name for row ${index + 1}`} value={row.recipientName} disabled={busy} aria-invalid={!row.recipientName.trim() || row.recipientName.trim().length > 40} onChange={event => edit(row.id, 'recipientName', event.target.value)} /><small>{row.recipientName.trim().length}/40</small></td>
            <td><textarea aria-label={`Comment for row ${index + 1}`} value={row.comment} disabled={busy} rows={2} aria-invalid={!row.comment.trim() || row.comment.trim().length > 70} onChange={event => edit(row.id, 'comment', event.target.value)} /><small>{row.comment.trim().length}/70</small>{issues.length > 0 && <small className="bank-export-issue">{issues.join(' ')}</small>}</td>
          </tr>
        })}</tbody>
      </table></div>
      <div className="month-closure-bulk-actions">
        <button type="button" className="month-closure-cancel-bulk" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" className="bank-note-summary-button" disabled={busy || invalidCount > 0 || !rows.length} onClick={() => void download()}><Download size={18} aria-hidden="true" />{busy ? 'Exporting...' : 'Export Excel'}</button>
      </div>
    </div>
  </dialog>
})
