export function parseHistoryDateRange(query) {
  const bounds = {}
  for (const key of ['from', 'until']) {
    const value = query[key]
    if (value === undefined || value === '') {
      bounds[key] = null
      continue
    }
    const date = typeof value === 'string' ? new Date(value) : new Date(NaN)
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
      return { error: 'Invalid history date range.' }
    }
    bounds[key] = date
  }
  if (bounds.from && bounds.until && bounds.from >= bounds.until) {
    return { error: 'From date must be on or before To date.' }
  }
  return bounds
}
