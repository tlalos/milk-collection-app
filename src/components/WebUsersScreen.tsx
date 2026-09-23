import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { appPath } from '../ocrPaths'
import './WebUsersScreen.css'

interface Permission {
  key: string
  label: string
}

interface WebRole {
  roleKey: string
  roleName: string
  description: string
  permissionKeys: string[]
}

interface WebUser {
  userId: string
  username: string
  fullName: string
  isActive: boolean
  isAdmin: boolean
  roleKeys: string[]
}

interface AuditRow {
  auditId: string
  occurredAt: string
  username: string
  action: string
  entityType: string
  entityId: string
  ipAddress: string
  reason: string
  changes: { field: string; before: string | number | null; after: string | number | null }[]
}

type ActivityArea = '' | 'reception' | 'deliveries'

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

interface AdminData {
  users: WebUser[]
  roles: WebRole[]
  permissions: Permission[]
  auditLog: AuditRow[]
}

const emptyUser: WebUser & { password: string } = {
  userId: '',
  username: '',
  fullName: '',
  password: '',
  isActive: true,
  isAdmin: false,
  roleKeys: [],
}

const emptyRole: WebRole = {
  roleKey: '',
  roleName: '',
  description: '',
  permissionKeys: [],
}

export function WebUsersScreen({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<AdminData>({ users: [], roles: [], permissions: [], auditLog: [] })
  const [selectedUserId, setSelectedUserId] = useState('')
  const [userDraft, setUserDraft] = useState(emptyUser)
  const [roleDraft, setRoleDraft] = useState(emptyRole)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activityArea, setActivityArea] = useState<ActivityArea>('')
  const [activityUsername, setActivityUsername] = useState('')
  const [activity, setActivity] = useState<AuditRow[]>([])
  const [activityCursor, setActivityCursor] = useState<string | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState('')
  const activityRequestId = useRef(0)

  const editableRoles = useMemo(() => data.roles.filter((role) => role.roleKey !== 'admin'), [data.roles])

  useEffect(() => {
    void loadData()
  }, [])

  const loadActivity = useCallback(async (beforeId: string | null) => {
    const reset = beforeId === null
    const requestId = ++activityRequestId.current
    setActivityLoading(true)
    setActivityError('')
    if (reset) {
      setActivity([])
      setActivityCursor(null)
    }
    try {
      const params = new URLSearchParams()
      if (activityArea) params.set('area', activityArea)
      if (activityUsername) params.set('username', activityUsername)
      if (beforeId) params.set('beforeId', beforeId)
      const response = await fetch(appPath(`/api/web-users/activity?${params.toString()}`))
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not load activity.')
      if (requestId !== activityRequestId.current) return
      setActivity((current) => reset ? payload.entries : [...current, ...payload.entries])
      setActivityCursor(payload.nextBeforeId)
    } catch (loadError) {
      if (requestId === activityRequestId.current) setActivityError(loadError instanceof Error ? loadError.message : 'Could not load activity.')
    } finally {
      if (requestId === activityRequestId.current) setActivityLoading(false)
    }
  }, [activityArea, activityUsername])

  useEffect(() => {
    void loadActivity(null)
  }, [loadActivity])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(appPath('/api/web-users/admin-data'))
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not load Web users.')
      setData(payload)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Web users.')
    } finally {
      setLoading(false)
    }
  }

  function selectUser(user: WebUser) {
    setSelectedUserId(user.userId)
    setUserDraft({ ...user, password: '' })
    setNotice('')
    setError('')
  }

  function newUser() {
    setSelectedUserId('')
    setUserDraft(emptyUser)
    setNotice('')
    setError('')
  }

  function selectRole(role: WebRole) {
    setRoleDraft({ ...role })
    setNotice('')
    setError('')
  }

  function newRole() {
    setRoleDraft(emptyRole)
    setNotice('')
    setError('')
  }

  function toggleUserRole(roleKey: string) {
    setUserDraft((current) => ({
      ...current,
      roleKeys: current.roleKeys.includes(roleKey)
        ? current.roleKeys.filter((key) => key !== roleKey)
        : [...current.roleKeys, roleKey],
    }))
  }

  function toggleRolePermission(permissionKey: string) {
    setRoleDraft((current) => ({
      ...current,
      permissionKeys: current.permissionKeys.includes(permissionKey)
        ? current.permissionKeys.filter((key) => key !== permissionKey)
        : [...current.permissionKeys, permissionKey],
    }))
  }

  async function saveUser() {
    setSaving('user')
    setError('')
    setNotice('')
    try {
      const endpoint = selectedUserId
        ? appPath(`/api/web-users/users/${encodeURIComponent(selectedUserId)}`)
        : appPath('/api/web-users/users')
      const response = await fetch(endpoint, {
        method: selectedUserId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userDraft),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not save Web user.')
      setData(payload)
      setSelectedUserId(payload.user.userId)
      setUserDraft({ ...payload.user, password: '' })
      setNotice('Web user saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save Web user.')
    } finally {
      setSaving('')
    }
  }

  async function saveRole() {
    setSaving('role')
    setError('')
    setNotice('')
    try {
      const response = await fetch(appPath('/api/web-users/roles'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roleDraft),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not save Web role.')
      setData(payload)
      setRoleDraft(payload.role)
      setNotice('Web role saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save Web role.')
    } finally {
      setSaving('')
    }
  }

  return (
    <div className="web-users-screen">
      <header className="web-users-header">
        <button type="button" onClick={onBack}>Back</button>
        <div>
          <span>Administration</span>
          <h1>Web Users</h1>
        </div>
      </header>

      <main className="web-users-main">
        {error && <div className="web-users-alert error">{error}</div>}
        {notice && <div className="web-users-alert success">{notice}</div>}

        <section className="web-users-panel">
          <div className="web-users-panel-title">
            <h2>Users</h2>
            <button type="button" onClick={newUser}>New user</button>
          </div>
          {loading ? <p className="web-users-muted">Loading...</p> : (
            <div className="web-users-grid">
              <div className="web-users-list">
                {data.users.map((user) => (
                  <button
                    key={user.userId}
                    type="button"
                    className={user.userId === selectedUserId ? 'selected' : ''}
                    onClick={() => selectUser(user)}
                  >
                    <strong>{user.username}</strong>
                    <span>{user.fullName || '-'}</span>
                    <em>{user.isAdmin ? 'Admin' : user.roleKeys.join(', ') || 'No role'}</em>
                  </button>
                ))}
              </div>

              <div className="web-users-form">
                <label>Username<input value={userDraft.username} onChange={(event) => setUserDraft((current) => ({ ...current, username: event.target.value }))} /></label>
                <label>Full name<input value={userDraft.fullName} onChange={(event) => setUserDraft((current) => ({ ...current, fullName: event.target.value }))} /></label>
                <label>{selectedUserId ? 'New password' : 'Password'}<input type="password" value={userDraft.password} onChange={(event) => setUserDraft((current) => ({ ...current, password: event.target.value }))} placeholder={selectedUserId ? 'Leave blank to keep current password' : ''} /></label>
                <div className="web-users-check-row">
                  <label><input type="checkbox" checked={userDraft.isActive} onChange={(event) => setUserDraft((current) => ({ ...current, isActive: event.target.checked }))} /> Active</label>
                  <label><input type="checkbox" checked={userDraft.isAdmin} onChange={(event) => setUserDraft((current) => ({ ...current, isAdmin: event.target.checked }))} /> Admin</label>
                </div>
                <div>
                  <h3>Roles</h3>
                  <div className="web-users-chip-grid">
                    {data.roles.map((role) => (
                      <label key={role.roleKey} className="web-users-chip">
                        <input type="checkbox" checked={userDraft.roleKeys.includes(role.roleKey)} onChange={() => toggleUserRole(role.roleKey)} />
                        {role.roleName}
                      </label>
                    ))}
                  </div>
                </div>
                <button className="web-users-save" type="button" onClick={() => void saveUser()} disabled={saving === 'user'}>
                  {saving === 'user' ? 'Saving...' : 'Save Web user'}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="web-users-panel">
          <div className="web-users-panel-title">
            <h2>Roles and Tile Access</h2>
            <button type="button" onClick={newRole}>New role</button>
          </div>
          <div className="web-users-grid">
            <div className="web-users-list">
              {editableRoles.map((role) => (
                <button key={role.roleKey} type="button" className={role.roleKey === roleDraft.roleKey ? 'selected' : ''} onClick={() => selectRole(role)}>
                  <strong>{role.roleName}</strong>
                  <span>{role.roleKey}</span>
                  <em>{role.permissionKeys.length} permissions</em>
                </button>
              ))}
            </div>
            <div className="web-users-form">
              <label>Role key<input value={roleDraft.roleKey} onChange={(event) => setRoleDraft((current) => ({ ...current, roleKey: event.target.value }))} placeholder="example: reception" disabled={Boolean(roleDraft.roleKey && data.roles.some((role) => role.roleKey === roleDraft.roleKey))} /></label>
              <label>Role name<input value={roleDraft.roleName} onChange={(event) => setRoleDraft((current) => ({ ...current, roleName: event.target.value }))} /></label>
              <label>Description<input value={roleDraft.description} onChange={(event) => setRoleDraft((current) => ({ ...current, description: event.target.value }))} /></label>
              <div>
                <h3>Tile/page access</h3>
                <div className="web-users-chip-grid">
                  {data.permissions.map((permission) => (
                    <label key={permission.key} className="web-users-chip">
                      <input type="checkbox" checked={roleDraft.permissionKeys.includes(permission.key)} onChange={() => toggleRolePermission(permission.key)} />
                      {permission.label}
                    </label>
                  ))}
                </div>
              </div>
              <button className="web-users-save" type="button" onClick={() => void saveRole()} disabled={saving === 'role'}>
                {saving === 'role' ? 'Saving...' : 'Save Web role'}
              </button>
            </div>
          </div>
        </section>

        <section className="web-users-panel">
          <div className="web-users-panel-title">
            <h2>Recent Activity</h2>
            <div className="web-users-activity-tools">
              <select aria-label="Activity user" value={activityUsername} onChange={(event) => setActivityUsername(event.target.value)}>
                <option value="">All users</option>
                {data.users.map((user) => <option key={user.userId} value={user.username}>{user.fullName || user.username}</option>)}
              </select>
              <select aria-label="Activity area" value={activityArea} onChange={(event) => setActivityArea(event.target.value as ActivityArea)}>
                <option value="">All activity</option>
                <option value="reception">Milk Reception</option>
                <option value="deliveries">Milk Deliveries</option>
              </select>
              <button type="button" onClick={() => void loadActivity(null)} disabled={activityLoading}>Refresh</button>
            </div>
          </div>
          {activityError && <div className="web-users-alert error" role="alert">{activityError}</div>}
          <div className="web-users-audit">
            {activity.map((row) => (
              <div key={row.auditId} className="web-users-audit-entry">
                <div className="web-users-audit-row">
                  <span>{new Date(row.occurredAt).toLocaleString()}</span>
                  <strong>{row.username || '-'}</strong>
                  <em>{actionNames[row.action] || row.action}</em>
                  <small>{row.entityId || (row.entityType === 'MilkReception' ? 'Milk Reception' : row.entityType === 'MilkDelivery' ? 'Milk Deliveries' : row.entityType)}</small>
                </div>
                {row.reason && <p className="web-users-audit-reason">{row.reason}</p>}
                {row.changes.length > 0 && (
                  <details className="web-users-audit-details">
                    <summary>{row.changes.length} field{row.changes.length === 1 ? '' : 's'} {row.action.endsWith('.create') ? 'recorded' : row.action.endsWith('.delete') ? 'removed' : 'changed'}</summary>
                    <div className="web-users-audit-changes">
                      {row.changes.map((change) => (
                        <div className="web-users-audit-change" key={change.field}>
                          <strong>{change.field}</strong>
                          {row.action.endsWith('.create') ? <span>{activityValue(change.after)}</span> : row.action.endsWith('.delete') ? <span>{activityValue(change.before)}</span> : <span>{activityValue(change.before)} <span aria-hidden="true">→</span> {activityValue(change.after)}</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
            {!activityLoading && activity.length === 0 && !activityError && <p className="web-users-muted web-users-audit-empty">No activity found.</p>}
          </div>
          {activityCursor && <div className="web-users-audit-more"><button type="button" onClick={() => void loadActivity(activityCursor)} disabled={activityLoading}>{activityLoading ? 'Loading...' : 'Load older activity'}</button></div>}
        </section>
      </main>
    </div>
  )
}
