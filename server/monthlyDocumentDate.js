// Short years on current collection documents mean 2000-2099, independent of locale.
export function normalizeMonthlyDocumentDate(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text)
  const slash = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/u.exec(text)
  if (!iso && !slash) return null
  const year = iso ? Number(iso[1]) : Number(slash[3]) + (slash[3].length === 2 ? 2000 : 0)
  const month = Number(iso ? iso[2] : slash[2])
  const day = Number(iso ? iso[3] : slash[1])
  if (year < 1000 || month < 1 || month > 12 || day < 1) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
