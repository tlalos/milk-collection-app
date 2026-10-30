export function validateJobListFilters(filters = {}) {
  const result = {}
  for (const key of ['documentCategory', 'reviewStatus', 'status', 'month']) {
    if (filters[key] === undefined || filters[key] === '') continue
    if (typeof filters[key] !== 'string' || filters[key].length > 64) {
      throw Object.assign(new Error('Invalid document filter.'), { status: 400 })
    }
    result[key] = filters[key]
  }
  if (result.month && !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(result.month)) {
    throw Object.assign(new Error('Invalid document month. Use YYYY-MM.'), { status: 400 })
  }
  return result
}

export function matchesJobListFilters(job, filters) {
  if (filters.documentCategory && (job.documentCategory || 'daily_routes') !== filters.documentCategory) return false
  if (filters.reviewStatus && job.reviewStatus !== filters.reviewStatus) return false
  if (filters.status && job.status !== filters.status) return false
  const date = /^\d{4}-\d{2}-\d{2}$/.test(job.data?.date || '') ? job.data.date : job.createdAt
  return !filters.month || String(date || '').slice(0, 7) === filters.month
}
