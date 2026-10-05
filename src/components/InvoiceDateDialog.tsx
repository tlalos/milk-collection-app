import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { displayInvoiceDate, maskInvoiceDate, parseInvoiceDate } from '../invoiceDateFormat'

export interface InvoiceDateDialogHandle {
  open(date: string): void
  close(): void
}

interface Props {
  saving: boolean
  onApply(date: string): void
}

export const InvoiceDateDialog = forwardRef<InvoiceDateDialogHandle, Props>(function InvoiceDateDialog({ saving, onApply }, ref) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState('')
  const date = parseInvoiceDate(draft)

  useImperativeHandle(ref, () => ({
    open(value) {
      setDraft(displayInvoiceDate(value))
      dialogRef.current?.showModal()
    },
    close() { dialogRef.current?.close() },
  }), [])

  return <dialog ref={dialogRef} className="month-closure-date-dialog" aria-labelledby="invoice-date-title"
    onCancel={event => { if (saving) event.preventDefault() }}>
    <form className="month-closure-bulk-editor" onSubmit={event => {
      event.preventDefault()
      if (date && !saving) onApply(date)
    }}>
      <h2 id="invoice-date-title">Apply date to all</h2>
      <label htmlFor="bulk-invoice-date-text"><span>Invoice date (dd/mm/yyyy)</span></label>
      <div className="month-closure-bulk-date-field">
        <input id="bulk-invoice-date-text" type="text" inputMode="numeric" autoComplete="off" required
          placeholder="dd/mm/yyyy" disabled={saving} value={draft}
          aria-invalid={Boolean(draft && !date)} aria-describedby={draft && !date ? 'invoice-date-error' : undefined}
          onChange={event => {
            const input = event.currentTarget
            const digitCount = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length
            const next = maskInvoiceDate(input.value)
            setDraft(next)
            // Keep the caret by the edited digits when separators are inserted or removed.
            const caret = Math.min(next.length, digitCount + (digitCount > 2 ? 1 : 0) + (digitCount > 4 ? 1 : 0))
            requestAnimationFrame(() => input.setSelectionRange(caret, caret))
          }}
          onKeyDown={event => {
            const input = event.currentTarget
            const position = input.selectionStart ?? 0
            if (position !== input.selectionEnd) return
            if (event.key === 'Backspace' && draft[position - 1] === '/') {
              event.preventDefault()
              setDraft(maskInvoiceDate(draft.slice(0, position - 2) + draft.slice(position)))
              requestAnimationFrame(() => input.setSelectionRange(position - 2, position - 2))
            }
          }} />
        <div className="month-closure-bulk-date-picker">
          <CalendarDays size={18} aria-hidden="true" />
          <input type="date" aria-label="Choose invoice date from calendar" title="Choose invoice date"
            disabled={saving} value={date || ''}
            onInput={event => setDraft(displayInvoiceDate(event.currentTarget.value))}
            onChange={event => setDraft(displayInvoiceDate(event.currentTarget.value))} />
        </div>
      </div>
      {draft && !date && <p id="invoice-date-error" className="month-closure-date-error" role="status">Enter a valid date in dd/mm/yyyy format.</p>}
      <div className="month-closure-bulk-actions">
        <button type="button" className="month-closure-cancel-bulk" disabled={saving} onClick={() => dialogRef.current?.close()}>Cancel</button>
        <button type="submit" className="month-closure-apply-bulk" disabled={!date || saving}>{saving ? 'Saving...' : 'Apply'}</button>
      </div>
    </form>
  </dialog>
})
