import { useRef } from 'react'
import { ChartNoAxesCombined } from 'lucide-react'
import { summarizeClosureCenters, type CenterSummarySource, type JournalProducer, type ReceptionFactor } from '../monthClosureCenterSummary'

const quantity = (value: number | null) => value === null ? '\u2014' : value.toLocaleString('en-US', { maximumFractionDigits: 3 })

export function MonthClosureCenterSummary({ month, rows, journalProducers, factors, filtered, loading }: {
  month: string
  rows: CenterSummarySource[]
  journalProducers: JournalProducer[]
  factors: ReceptionFactor[]
  filtered: boolean
  loading: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const summary = summarizeClosureCenters(month, rows, journalProducers, factors)
  return <>
    <button type="button" className="bank-note-summary-button" disabled={loading || !month} onClick={() => dialog.current?.showModal()}>
      <ChartNoAxesCombined size={18} aria-hidden="true" /> Summary
    </button>
    <dialog ref={dialog} className="month-closure-date-dialog center-summary-dialog" aria-labelledby="center-summary-title">
      <div className="bank-note-summary-content">
        <h2 id="center-summary-title">Center summary</h2>
        <p>{month.split('-').reverse().join('/')} · {filtered ? 'Current filters' : 'All rows'} · {summary.groups.length} centers</p>
        <div className="bank-note-summary-table-wrap center-summary-table-wrap" role="region" aria-label="Center quantities" tabIndex={0}>
          <table className="bank-note-summary-table center-summary-table">
            <thead><tr><th scope="col">Center</th><th scope="col">Journal producers</th><th scope="col">Ready L</th><th scope="col">Blocked L</th><th scope="col">Total L</th><th scope="col">Estimated kg</th></tr></thead>
            <tbody>{summary.groups.map(group => <tr key={group.key}>
              <th scope="row">{group.center}</th><td>{group.producerCount}</td><td>{quantity(group.readyLiters)}</td><td>{quantity(group.blockedLiters)}</td><td>{quantity(group.totalLiters)}</td><td>{quantity(group.estimatedKg)}</td>
            </tr>)}
              {!summary.groups.length && <tr><td colSpan={6}>No centers match the selected month and filters.</td></tr>}
            </tbody>
            <tfoot><tr><th scope="row">Total</th><td>{summary.producerCount}</td><td>{quantity(summary.readyLiters)}</td><td>{quantity(summary.blockedLiters)}</td><td>{quantity(summary.totalLiters)}</td><td>{quantity(summary.estimatedKg)}</td></tr></tfoot>
          </table>
        </div>
        <p>Journal producers: distinct producers in each center's journals for the full selected month. Aviz-only and collector-only rows are excluded from this count.</p>
        <p>Quantities follow the current filters. Estimated kg = liters × current Reception milk factor, calculated separately for each milk type; these are not scale weights.</p>
        {summary.estimatedKg === null && <p role="status">Some milk factors are unavailable. A dash marks an incomplete kilogram estimate.</p>}
        <div className="month-closure-bulk-actions"><button type="button" className="month-closure-cancel-bulk" onClick={() => dialog.current?.close()}>Close</button></div>
      </div>
    </dialog>
  </>
}
