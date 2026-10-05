import { useRef } from 'react'
import { ChartNoAxesCombined } from 'lucide-react'
import { summarizeBankNote, type BankSummaryRow } from '../bankNoteSummary'

const money = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const labels = { above: 'Centres over 5,000 L', remaining: 'Centres up to 5,000 L', unassigned: 'Unassigned centre' }

export function BankNoteSummary({ month, volumes, payments, filtered, loading }: {
  month: string
  volumes: { month: string; center: string; liters: number }[]
  payments: BankSummaryRow[]
  filtered: boolean
  loading: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const summary = summarizeBankNote(month, volumes, payments)
  return <>
    <button type="button" className="bank-note-summary-button" disabled={loading} onClick={() => dialog.current?.showModal()}>
      <ChartNoAxesCombined size={18} aria-hidden="true" /> Summary
    </button>
    <dialog ref={dialog} className="month-closure-date-dialog bank-note-summary-dialog" aria-labelledby="bank-note-summary-title">
      <div className="bank-note-summary-content">
        <h2 id="bank-note-summary-title">Bank note summary</h2>
        <p>{month.split('-').reverse().join('/')} · Pending payments · {filtered ? 'Current filters' : 'All producers'}</p>
        <div className="bank-note-summary-table-wrap">
          <table className="bank-note-summary-table">
            <thead><tr><th scope="col">Centre monthly volume</th><th scope="col">Final amount</th><th scope="col">Ready for bank</th></tr></thead>
            <tbody>{summary.groups.map(group => <tr key={group.key}>
              <th scope="row">{labels[group.key]}</th><td>{money(group.pendingAmount)}</td><td>{money(group.readyAmount)}</td>
            </tr>)}</tbody>
            <tfoot><tr><th scope="row">Total</th><td>{money(summary.groups.reduce((sum, group) => sum + group.pendingAmount, 0))}</td><td>{money(summary.groups.reduce((sum, group) => sum + group.readyAmount, 0))}</td></tr></tfoot>
          </table>
        </div>
        <div className="bank-note-summary-blocked"><strong>{summary.blockedProducers}</strong> {summary.blockedProducers === 1 ? 'producer blocked' : 'producers blocked'} from bank export</div>
        <p>Missing IBAN or final amount. Each producer is counted once.</p>
        {summary.missingAmountRows > 0 && <p>{summary.missingAmountRows} pending {summary.missingAmountRows === 1 ? 'row has' : 'rows have'} no final amount and {summary.missingAmountRows === 1 ? 'is' : 'are'} excluded from the totals.</p>}
        <p>Centre volumes include all milk types for the full month. Exported payments are excluded.</p>
        <div className="month-closure-bulk-actions"><button type="button" className="month-closure-cancel-bulk" onClick={() => dialog.current?.close()}>Close</button></div>
      </div>
    </dialog>
  </>
}
