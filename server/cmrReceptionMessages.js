import { normalizeCmrTruck } from './cmrReceptionMatching.js'
import { normalizeReconciliationDate, normalizeReconciliationKey } from './reconciliationKeys.js'
import { currentMilkDate } from './milkDocumentDate.js'

export function receptionMessageMonths(now = new Date()) {
  const current = currentMilkDate(now).slice(0, 7)
  const [year, month] = current.split('-').map(Number)
  const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
  return [current, previous]
}

const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10)
const key = (date, truck) => `${day(date)}|${normalizeCmrTruck(truck)}`
const weighed = row => [row.fullTruckWeightKg, row.emptyTruckWeightKg, row.netQuantityKg]
  .every(value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)))

export function cmrReceptionMessages(jobs, receptions, links) {
  const byKey = new Map()
  for (const row of receptions) {
    if (row.vehicleCategory !== 'OTHER') continue
    const rowKey = key(row.receptionDate, row.vehicleRegistration)
    if (!byKey.has(rowKey)) byKey.set(rowKey, [])
    byKey.get(rowKey).push(row)
  }
  const byJob = new Map(links.map(link => [link.jobId, link]))
  const messages = []
  for (const job of jobs) {
    const data = job.data || {}
    if (job.documentCategory !== 'cmr' || job.status !== 'completed' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') || !normalizeCmrTruck(data.truckNumber)) continue
    const candidates = byKey.get(key(data.date, data.truckNumber)) || []
    const link = byJob.get(job.id)
    const linked = candidates.find(row => row.receptionId === link?.receptionId)
    if (link?.status === 'CONFIRMED' && linked && weighed(linked)) continue
    const kind = !candidates.length ? 'missing_reception'
      : !(linked ? weighed(linked) : candidates.some(weighed)) ? 'missing_weights'
        : link ? 'review_link' : 'confirm_match'
    // Reception users receive only the operational summary, not OCR payloads or source files.
    messages.push({ id: job.id, documentType: 'cmr', kind, receptionDate: data.date, truckNumber: data.truckNumber,
      supplier: data.supplier || '', avizNumber: data.avizNumber || '',
      quantity: data.quantity === undefined ? data.kilos ?? null : data.quantity,
      unit: data.quantityUnit ?? 'kg', reviewed: job.reviewStatus === 'reviewed' })
  }
  return messages.sort((a, b) => b.receptionDate.localeCompare(a.receptionDate) || a.truckNumber.localeCompare(b.truckNumber) || a.id.localeCompare(b.id))
}

export function dailyAvizReceptionMessages(jobs, receptions) {
  const routeKey = (date, truck, route) => `${normalizeReconciliationDate(date)}|${normalizeReconciliationKey(truck)}|${normalizeReconciliationKey(route)}`
  const byKey = new Map()
  for (const row of receptions) {
    if (String(row.vehicleCategory || 'COLLECTION').toUpperCase() !== 'COLLECTION') continue
    const rowKey = routeKey(row.receptionDate, row.vehicleRegistration, row.routeId)
    if (!byKey.has(rowKey)) byKey.set(rowKey, [])
    byKey.get(rowKey).push(row)
  }
  return jobs.flatMap(job => {
    const data = job.data || {}
    const date = normalizeReconciliationDate(data.date)
    if ((job.documentCategory || 'daily_routes') !== 'daily_routes' || job.status !== 'completed'
      || !date || !normalizeReconciliationKey(data.vehicleRegistration) || !normalizeReconciliationKey(data.route)) return []
    const matches = byKey.get(routeKey(date, data.vehicleRegistration, data.route)) || []
    if (matches.length === 1 && weighed(matches[0])) return []
    const rows = Array.isArray(data.rows) ? data.rows : []
    const liters = rows.map(row => row.liters === null || row.liters === undefined || row.liters === '' ? null : Number(row.liters))
    return [{ id: job.id, documentType: 'daily_aviz',
      kind: matches.length > 1 ? 'multiple_receptions' : matches.length ? 'missing_weights' : 'missing_reception',
      receptionDate: date, truckNumber: data.vehicleRegistration, route: data.route, supplier: '',
      avizNumber: [...new Set(rows.map(row => row.noticeNumber).filter(Boolean))].join(', '),
      quantity: liters.length && liters.every(value => value !== null && Number.isFinite(value)) ? liters.reduce((sum, value) => sum + value, 0) : null,
      unit: 'L', reviewed: job.reviewStatus === 'reviewed' }]
  })
}

export function registerCmrReceptionMessages(app, { requirePermission, listJobs, listMilkReceptions, listCmrReconciliationLinks, now = () => new Date() }) {
  app.get(['/api/milk-receptions/messages', '/api/milk-receptions/cmr-messages'], requirePermission('milk_reception'), async (_request, response, next) => {
    try {
      const allowedMonths = receptionMessageMonths(now())
      const jobs = (await listJobs()).filter(job => ['cmr', 'daily_routes'].includes(job.documentCategory || 'daily_routes') && job.status === 'completed'
        && allowedMonths.includes(normalizeReconciliationDate(job.data?.date).slice(0, 7)))
      const months = [...new Set(jobs.map(job => normalizeReconciliationDate(job.data?.date).slice(0, 7)).filter(month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)))]
      // The general reception list is capped at 500; month queries include every row.
      const receptions = []
      for (const month of months) receptions.push(...await listMilkReceptions({ month, includeQualityDetails: false }))
      const links = await listCmrReconciliationLinks()
      const messages = [...cmrReceptionMessages(jobs, receptions, links), ...dailyAvizReceptionMessages(jobs, receptions)]
        .sort((a, b) => b.receptionDate.localeCompare(a.receptionDate) || a.truckNumber.localeCompare(b.truckNumber) || a.id.localeCompare(b.id))
      response.set('Cache-Control', 'no-store').json({ messages })
    } catch (error) { next(error) }
  })
}
