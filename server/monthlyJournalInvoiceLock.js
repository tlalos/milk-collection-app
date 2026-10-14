import { normalizeMonthlyDocumentDate } from './monthlyDocumentDate.js'
import { matchingMonthlyProducer } from './monthlyProducerValidation.js'

function sources(job) {
  const result = new Map()
  if (job?.documentCategory !== 'journal_monthly_settlement') return result
  const date = normalizeMonthlyDocumentDate(job.data?.date)
  const monthNumber = Number(job.data?.documentMonth)
  const year = new Date(job.createdAt).getFullYear()
  const month = date?.slice(0, 7) || (Number.isInteger(monthNumber) && monthNumber > 0 && monthNumber < 13 && Number.isFinite(year) ? `${year}-${String(monthNumber).padStart(2, '0')}` : '')
  for (const row of job.data?.rows || []) {
    const match = matchingMonthlyProducer(row, job.producerMatches?.find(m => Number(m.rowNumber) === Number(row.rowNumber)))
    const producer = String(match?.selectedCode || '').trim().toLowerCase()
    const rawMilk = String(row.milkType || job.data.milkType || '').toUpperCase().replace(/^MILK[-_\s]*/, '')
    const milk = `MILK-${rawMilk}`
    if (!month || !producer) continue
    const key = JSON.stringify([month, producer, milk])
    const entry = result.get(key) || { month, producer, milk, rows: [] }
    entry.rows.push({ row, date, center: job.data.headerCenterName, producerName: match.selectedName })
    result.set(key, entry)
  }
  return result
}

export function changedMonthlyInvoiceSources(before, after) {
  const oldSources = sources(before), nextSources = sources(after)
  return [...new Set([...oldSources.keys(), ...nextSources.keys()])]
    .filter(key => JSON.stringify(oldSources.get(key)) !== JSON.stringify(nextSources.get(key)))
    .map(key => { const [month, producer, milk] = JSON.parse(key); return { month, producer, milk } })
}
