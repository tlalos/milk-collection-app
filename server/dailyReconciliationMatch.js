export function reconciliationDate(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return ''
    const two = (part) => String(part).padStart(2, '0')
    return `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}`
  }
  const text = String(value || '').trim()
  const iso = /^(\d{4}-\d{2}-\d{2})/u.exec(text)
  if (iso) return iso[1]
  const display = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(text)
  return display ? `${display[3]}-${display[2].padStart(2, '0')}-${display[1].padStart(2, '0')}` : ''
}

export function reconciliationKey(date, truck, route) {
  const normalized = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase().replace(/[^A-Z0-9]+/gu, '')
  const day = reconciliationDate(date)
  const vehicle = normalized(truck)
  const routeId = normalized(route)
  return day && vehicle && routeId ? `${day}|${vehicle}|${routeId}` : ''
}

export function desiredDailyAvizLinks(receptions, jobs, dates = null) {
  const includedDates = dates ? new Set(dates.map(reconciliationDate).filter(Boolean)) : null
  const receptionsByKey = new Map()
  for (const reception of receptions) {
    if (String(reception.vehicleCategory || '').toUpperCase() !== 'COLLECTION') continue
    const key = reconciliationKey(reception.receptionDate, reception.vehicleRegistration, reception.routeId)
    if (!key || (includedDates && !includedDates.has(key.slice(0, 10)))) continue
    const matches = receptionsByKey.get(key) || []
    matches.push(reception)
    receptionsByKey.set(key, matches)
  }

  const links = []
  for (const job of jobs) {
    if ((job.documentCategory || 'daily_routes') !== 'daily_routes') continue
    if (job.status !== 'completed' || job.reviewStatus !== 'reviewed') continue
    const key = reconciliationKey(job.data?.date, job.data?.vehicleRegistration, job.data?.route)
    if (!key || (includedDates && !includedDates.has(key.slice(0, 10)))) continue
    const matches = receptionsByKey.get(key) || []
    if (matches.length !== 1) continue
    const rows = Array.isArray(job.data?.rows) ? job.data.rows : []
    rows.forEach((row, rowIndex) => {
      links.push({
        jobId: job.id,
        rowIndex,
        rowNumber: Number.isInteger(row.rowNumber) ? row.rowNumber : null,
        receptionId: matches[0].receptionId,
        documentDate: key.slice(0, 10),
      })
    })
  }
  return links
}
