export function historyDateRange(fromDate: string, toDate: string) {
  if (fromDate && toDate && fromDate > toDate) throw new Error('From date must be on or before To date.')
  const boundary = (value: string, nextDay = false) => {
    if (!value) return ''
    const date = new Date(`${value}T00:00:00`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime())) throw new Error('Invalid history date.')
    // Calendar arithmetic includes the whole local day, including daylight-saving changes.
    if (nextDay) date.setDate(date.getDate() + 1)
    return date.toISOString()
  }
  return { from: boundary(fromDate), until: boundary(toDate, true) }
}
