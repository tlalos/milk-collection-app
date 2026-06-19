import type { ERP_SuppliesPickingOrder } from '../types/suppliesOrder'
import './ErpPayloadDebugModal.css'

interface ErpPayloadDebugModalProps {
  payload: ERP_SuppliesPickingOrder[]
  isSending: boolean
  onCancel: () => void
  onSend: () => void
}

function displayValue(value: string | number) {
  if (value === '') return '(blank)'
  return String(value)
}

export function ErpPayloadDebugModal({
  payload,
  isSending,
  onCancel,
  onSend,
}: ErpPayloadDebugModalProps) {
  const payloadJson = JSON.stringify(payload, null, 2)

  return (
    <div className="erp-debug-backdrop" role="dialog" aria-modal="true" aria-labelledby="erp-debug-title">
      <section className="erp-debug-window">
        <header className="erp-debug-header">
          <div>
            <span>ERP debug</span>
            <h2 id="erp-debug-title">Values that will be sent</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={isSending} aria-label="Close debug window">
            x
          </button>
        </header>

        <div className="erp-debug-summary">
          {payload.map((row, index) => (
            <article className="erp-debug-row" key={`${row.internalnum}-${row.item_code}-${index}`}>
              <div className="erp-debug-row-title">
                <strong>{row.item_code}</strong>
                <span>{row.item_comments || `Line ${index + 1}`}</span>
              </div>

              <dl>
                <div>
                  <dt>salespickingseries</dt>
                  <dd>{displayValue(row.salespickingseries)}</dd>
                </div>
                <div>
                  <dt>store</dt>
                  <dd>{displayValue(row.store)}</dd>
                </div>
                <div>
                  <dt>store_id</dt>
                  <dd>{displayValue(row.store_id)}</dd>
                </div>
                <div>
                  <dt>frombranch</dt>
                  <dd>{displayValue(row.frombranch)}</dd>
                </div>
                <div>
                  <dt>fromstore</dt>
                  <dd>{displayValue(row.fromstore)}</dd>
                </div>
                <div>
                  <dt>tobranch</dt>
                  <dd>{displayValue(row.tobranch)}</dd>
                </div>
                <div>
                  <dt>tostore</dt>
                  <dd>{displayValue(row.tostore)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>

        <details className="erp-debug-json">
          <summary>Full payload JSON</summary>
          <pre>{payloadJson}</pre>
        </details>

        <footer className="erp-debug-actions">
          <button className="erp-debug-cancel" type="button" onClick={onCancel} disabled={isSending}>
            Cancel
          </button>
          <button className="erp-debug-send" type="button" onClick={onSend} disabled={isSending}>
            {isSending ? 'Sending...' : 'Send now'}
          </button>
        </footer>
      </section>
    </div>
  )
}
