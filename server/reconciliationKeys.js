export function normalizeReconciliationKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase().replace(/[^A-Z0-9]+/gu, '')
}

export function normalizeReconciliationDate(value) {
  if (!value) return ''
  const two = part => String(part).padStart(2, '0')
  const localDay = date => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
  if (value instanceof Date && Number.isFinite(value.getTime())) return localDay(value)
  const text = String(value || '').trim()
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/u.exec(text)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  const displayMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(text)
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2].padStart(2, '0')}-${displayMatch[1].padStart(2, '0')}`
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? localDay(new Date(timestamp)) : ''
}
