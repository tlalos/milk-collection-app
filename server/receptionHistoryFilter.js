export function parseReceptionHistoryDate(value) {
  if (value === undefined || value === '') return { receptionDate: null }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: 'Invalid reception date.' }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCFullYear() < 1) {
    return { error: 'Invalid reception date.' }
  }
  return { receptionDate: value }
}

// Match the reception, not the time of the change. Snapshots retain deleted
// receptions and both dates when a reception date itself was corrected.
export function receptionHistoryDateSql(idColumn) {
  if (!['a.entityId', 'e.receptionId'].includes(idColumn)) throw new Error('Unsupported reception history identifier.')
  return `(@receptionDate IS NULL OR EXISTS (
    SELECT 1 FROM dbo.MilkReceptions r
    WHERE r.receptionId = ${idColumn} AND r.receptionDate = CONVERT(date, @receptionDate, 23)
  ) OR EXISTS (
    SELECT 1 FROM dbo.AppAuditLog history
    WHERE history.entityType = N'MilkReception' AND history.entityId = ${idColumn}
      AND (
        LEFT(JSON_VALUE(CASE WHEN ISJSON(history.beforeJson) = 1 THEN history.beforeJson ELSE N'{}' END, '$.receptionDate'), 10) = @receptionDate
        OR LEFT(JSON_VALUE(CASE WHEN ISJSON(history.afterJson) = 1 THEN history.afterJson ELSE N'{}' END, '$.receptionDate'), 10) = @receptionDate
      )
  ))`
}
