import { useCallback, useEffect, useRef, useState } from 'react'
import { appPath } from '../ocrPaths'
import './WebUsersScreen.css'
import './WebUserHistoryScreen.css'

type HistoryTab = 'general' | 'weights'
type ActivityArea = '' | 'reception' | 'deliveries'
type WeightSource = '' | 'SCALE' | 'MANUAL'
type WeightKind = '' | 'FULL' | 'EMPTY'

interface AuditRow {
  auditId: string
  occurredAt: string
  username: string
  action: string
  entityType: string
  entityId: string
  reason: string
  changes: { field: string; before: string | number | null; after: string | number | null }[]
}

interface WeightRow {
  eventId: string
  receptionId: string
  weightKind: 'FULL' | 'EMPTY'
  source: 'SCALE' | 'MANUAL'
  weightKg: number | null
  previousWeightKg: number | null
  previousSource: 'SCALE' | 'MANUAL' | null
  scaleCapturedAt: string | null
  recordedAt: string
  username: string
}

const actionNames: Record<string, string> = {
  'auth.login.success': 'Signed in',
  'auth.login.failed': 'Sign-in failed',
  'auth.logout': 'Signed out',
  'milk_reception.open': 'Opened Milk Reception',
  'milk_reception.create': 'Created reception',
  'milk_reception.create.failed': 'Could not create reception',
  'milk_reception.update': 'Updated reception',
  'milk_reception.update.failed': 'Could not update reception',
  'milk_reception.delete': 'Deleted reception',
  'milk_reception.delete.failed': 'Could not delete reception',
  'milk_delivery.open': 'Opened Milk Deliveries',
  'milk_delivery.create': 'Created delivery',
  'milk_delivery.create.failed': 'Could not create delivery',
  'milk_delivery.update': 'Updated delivery',
  'milk_delivery.update.failed': 'Could not update delivery',
  'milk_delivery.delete': 'Deleted delivery',
  'milk_delivery.delete.failed': 'Could not delete delivery',
}

function activityValue(value: string | number | null) {
  return value === null || value === '' ? 'Empty' : String(value)
}

function weightValue(value: number | null) {
  return value === null ? 'Empty' : `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`
}

function displayTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

export function WebUserHistoryScreen() {
  const [tab, setTab] = useState<HistoryTab>('general')
  const [users, setUsers] = useState<{ userId: string; username: string; fullName: string }[]>([])
  const [username, setUsername] = useState('')
  const [recordSearch, setRecordSearch] = useState('')
  const [area, setArea] = useState<ActivityArea>('')
  const [source, setSource] = useState<WeightSource>('')
  const [weightKind, setWeightKind] = useState<WeightKind>('')
  const [activity, setActivity] = useState<AuditRow[]>([])
  const [weights, setWeights] = useState<WeightRow[]>([])
  const [nextBeforeId, setNextBeforeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)

  useEffect(() => {
    void fetch(appPath('/api/web-users/admin-data'))
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Could not load users.')
        setUsers(payload.users || [])
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load users.'))
  }, [])

  const loadHistory = useCallback(async (beforeId: string | null = null) => {
    const requestId = ++requestIdRef.current
    const reset = beforeId === null
    setLoading(true)
    setError('')
    if (reset) {
      setActivity([])
      setWeights([])
      setNextBeforeId(null)
    }
    try {
      const params = new URLSearchParams()
      if (username) params.set('username', username)
      if (recordSearch.trim()) params.set(tab === 'general' ? 'entityId' : 'receptionId', recordSearch.trim())
      if (beforeId) params.set('beforeId', beforeId)
      if (tab === 'general' && area) params.set('area', area)
      if (tab === 'weights' && source) params.set('source', source)
      if (tab === 'weights' && weightKind) params.set('weightKind', weightKind)
      const endpoint = tab === 'general' ? '/api/web-users/activity' : '/api/web-users/weight-history'
      const response = await fetch(appPath(`${endpoint}?${params.toString()}`))
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not load history.')
      if (requestId !== requestIdRef.current) return
      if (tab === 'general') setActivity((current) => reset ? payload.entries || [] : [...current, ...(payload.entries || [])])
      else setWeights((current) => reset ? payload.entries || [] : [...current, ...(payload.entries || [])])
      setNextBeforeId(payload.nextBeforeId || null)
    } catch (loadError) {
      if (requestId === requestIdRef.current) setError(loadError instanceof Error ? loadError.message : 'Could not load history.')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [area, recordSearch, source, tab, username, weightKind])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadHistory(), recordSearch ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [loadHistory, recordSearch])

  return <div className="web-users-screen">
    <header className="web-users-header">
      <button type="button" onClick={() => { window.location.href = appPath('/web-users') }}>Back to users</button>
      <div><span>Administration</span><h1>User Log History</h1></div>
    </header>
    <main className="web-users-main user-log-main">
      <div className="user-log-tabs" role="tablist" aria-label="History source">
        <button type="button" role="tab" aria-selected={tab === 'general'} onClick={() => setTab('general')}>General activity</button>
        <button type="button" role="tab" aria-selected={tab === 'weights'} onClick={() => setTab('weights')}>Reception weights</button>
      </div>
      <section className="user-log-panel">
        <div className="user-log-filters">
          <select aria-label="User" value={username} onChange={(event) => setUsername(event.target.value)}>
            <option value="">All users</option>
            {users.map((user) => <option key={user.userId} value={user.username}>{user.fullName || user.username}</option>)}
          </select>
          <input aria-label="Record ID" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Record ID" />
          {tab === 'general' ? <select aria-label="Area" value={area} onChange={(event) => setArea(event.target.value as ActivityArea)}>
            <option value="">All areas</option>
            <option value="reception">Milk Reception</option>
            <option value="deliveries">Milk Deliveries</option>
          </select> : <>
            <select aria-label="Weight source" value={source} onChange={(event) => setSource(event.target.value as WeightSource)}>
              <option value="">All sources</option><option value="SCALE">Scale</option><option value="MANUAL">Manual</option>
            </select>
            <select aria-label="Weight field" value={weightKind} onChange={(event) => setWeightKind(event.target.value as WeightKind)}>
              <option value="">Full and empty</option><option value="FULL">Full kg</option><option value="EMPTY">Empty kg</option>
            </select>
          </>}
          <button type="button" onClick={() => void loadHistory()} disabled={loading}>Refresh</button>
        </div>
        {error && <div className="web-users-alert error" role="alert">{error}</div>}
        {tab === 'general' ? <div className="web-users-audit">
          {activity.map((row) => <div key={row.auditId} className="web-users-audit-entry">
            <div className="web-users-audit-row">
              <span>{displayTime(row.occurredAt)}</span>
              <strong>{row.username || '-'}</strong>
              <em>{actionNames[row.action] || row.action}</em>
              <small>{row.entityId || row.entityType || '-'}</small>
            </div>
            {row.reason && <p className="web-users-audit-reason">{row.reason}</p>}
            {row.changes.length > 0 && <details className="web-users-audit-details">
              <summary>{row.changes.length} field{row.changes.length === 1 ? '' : 's'} {row.action.endsWith('.create') ? 'recorded' : row.action.endsWith('.delete') ? 'removed' : 'changed'}</summary>
              <div className="web-users-audit-changes">{row.changes.map((change) => <div className="web-users-audit-change" key={change.field}>
                <strong>{change.field}</strong>
                <span>{row.action.endsWith('.create') ? activityValue(change.after) : row.action.endsWith('.delete') ? activityValue(change.before) : `${activityValue(change.before)} → ${activityValue(change.after)}`}</span>
              </div>)}</div>
            </details>}
          </div>)}
          {!loading && activity.length === 0 && !error && <p className="web-users-muted web-users-audit-empty">No activity found.</p>}
        </div> : <div className="user-log-table-wrap">
          <table className="user-log-table">
            <thead><tr><th>Recorded</th><th>User</th><th>Reception</th><th>Weight</th><th>Source</th><th>Change</th><th>Scale time</th></tr></thead>
            <tbody>{weights.map((row) => <tr key={row.eventId}>
              <td>{displayTime(row.recordedAt)}</td>
              <td>{row.username || '-'}</td>
              <td className="user-log-record-id">{row.receptionId}</td>
              <td>{row.weightKind === 'FULL' ? 'Full kg' : 'Empty kg'}</td>
              <td><span className={`user-log-source ${row.source.toLowerCase()}`}>{row.source === 'SCALE' ? 'Scale' : 'Manual'}</span></td>
              <td>{weightValue(row.previousWeightKg)}{row.previousSource ? ` (${row.previousSource === 'SCALE' ? 'Scale' : 'Manual'})` : ''} <span aria-hidden="true">→</span> {weightValue(row.weightKg)}</td>
              <td>{displayTime(row.scaleCapturedAt)}</td>
            </tr>)}</tbody>
          </table>
          {!loading && weights.length === 0 && !error && <p className="web-users-muted web-users-audit-empty">No weight history found.</p>}
        </div>}
        {loading && <p className="web-users-muted web-users-audit-empty" role="status">Loading history...</p>}
        {nextBeforeId && <div className="web-users-audit-more"><button type="button" disabled={loading} onClick={() => void loadHistory(nextBeforeId)}>Load older</button></div>}
      </section>
    </main>
  </div>
}
