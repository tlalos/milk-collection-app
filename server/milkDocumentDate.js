const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function currentMilkDate(now = new Date()) {
  const parts = Object.fromEntries(calendar.formatToParts(now).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function milkDocumentDateError(value, label, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${label} date is required and must be valid.`
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || parsed.getUTCFullYear() < 1) {
    return `${label} date must be valid.`
  }
  return value > currentMilkDate(now) ? `${label} date cannot be later than today.` : ''
}

export function assertMilkDocumentDate(value, label, now = new Date()) {
  const message = milkDocumentDateError(value, label, now)
  if (message) {
    const error = new Error(message)
    error.status = 400
    throw error
  }
}
