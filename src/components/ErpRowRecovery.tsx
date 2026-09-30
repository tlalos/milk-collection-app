import { useState } from 'react'
import type { DailyRouteErpRowLog } from '../store/dailyRouteErpStore'

export type ErpManualChecks = Record<'aviz' | 'nir', { outcome: '' | 'found' | 'absent'; erpId: string }>

export function ErpRowRecovery({ row, busy, isRo, onRecover }: {
  row: DailyRouteErpRowLog
  busy: boolean
  isRo: boolean
  onRecover: (checks: ErpManualChecks) => Promise<void>
}) {
  const [checks, setChecks] = useState<ErpManualChecks>({ aviz: { outcome: '', erpId: '' }, nir: { outcome: '', erpId: '' } })
  const [confirmed, setConfirmed] = useState(false)
  const unresolved = (['aviz', 'nir'] as const).filter(kind => row.documents?.find(doc => doc.kind === kind)?.status !== 'sent')
  if (!unresolved.length || (!row.documents?.length && row.status === 'sent')) return null
  const valid = confirmed && unresolved.every(kind => checks[kind].outcome === 'absent' || (checks[kind].outcome === 'found' && /^[1-9]\d*$/.test(checks[kind].erpId.trim())))
  return <details className="erp-row-recovery">
    <summary>{isRo ? 'Verificare / recuperare' : 'Verify / recover row'}</summary>
    {unresolved.map(kind => <div key={kind} className="erp-recovery-document">
      <label>{kind === 'aviz' ? 'Aviz 5101' : 'NIR 2153'}
        <select disabled={busy} value={checks[kind].outcome} onChange={event => {
          const outcome = event.target.value as '' | 'found' | 'absent'
          setChecks(current => ({ ...current, [kind]: { ...current[kind], outcome } }))
          setConfirmed(false)
        }}>
          <option value="">{isRo ? 'Rezultat verificare ERP...' : 'ERP lookup result...'}</option>
          <option value="found">{isRo ? 'Găsit în ERP' : 'Found in ERP'}</option>
          <option value="absent">{isRo ? 'Verificat ERP: nu există' : 'Checked ERP: not found'}</option>
        </select>
      </label>
      {checks[kind].outcome === 'found' && <label>ERP ID
        <input disabled={busy} inputMode="numeric" value={checks[kind].erpId} onChange={event => {
          const erpId = event.target.value
          setChecks(current => ({ ...current, [kind]: { ...current[kind], erpId } }))
          setConfirmed(false)
        }} />
      </label>}
    </div>)}
    <label className="erp-recovery-confirm">
      <input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
      {isRo ? 'Am verificat data, centrul, avizul, tipul de lapte și cantitatea în ERP. Trimiterea inițială s-a oprit.' : 'I checked the date, center, aviz number, milk type and quantity in ERP. The original send is no longer running.'}
    </label>
    <button type="button" disabled={busy || !valid} onClick={() => void onRecover(checks)}>
      {busy ? (isRo ? 'În curs...' : 'Working...') : (isRo ? 'Confirmați recuperarea' : 'Confirm recovery')}
    </button>
  </details>
}
