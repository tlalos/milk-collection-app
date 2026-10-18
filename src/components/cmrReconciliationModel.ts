import { dateKey, numberOrNull, type ReceptionRow } from './dailyReconciliationModel.ts'

export interface CmrDocument {
  id: string
  sourceFile: string
  documentDate: string | null
  createdAt: string
  vehicleRegistration: string
  supplier: string
  driver: string
  avizNumber: string
  quantity: number | null
  quantityUnit: '' | 'kg' | 'L'
  jobStatus: string
  reviewStatus: string
}
export interface CmrLink { jobId: string; receptionId: string; status: string }
export type CmrComparisonStatus = 'only_cmr' | 'only_scale' | 'match_available' | 'needs_review' | 'awaiting_weight' | 'linked' | 'difference' | 'missing_info'
export interface CmrComparison {
  id: string
  date: string
  reception: ReceptionRow | null
  documents: CmrDocument[]
  suggestions: CmrDocument[]
  status: CmrComparisonStatus
  difference: number | null
  unit: 'kg' | 'L' | null
}
const truckKey = (value: string) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/gu, '')
export const cmrDay = (doc: CmrDocument) => dateKey(doc.documentDate) || dateKey(doc.createdAt)
function matches(doc: CmrDocument, row: ReceptionRow) {
  return row.vehicleCategory === 'OTHER' && Boolean(dateKey(doc.documentDate) && truckKey(doc.vehicleRegistration))
    && dateKey(doc.documentDate) === dateKey(row.receptionDate) && truckKey(doc.vehicleRegistration) === truckKey(row.vehicleRegistration)
}

export function buildCmrReconciliation(receptions: ReceptionRow[], documents: CmrDocument[], links: CmrLink[], month: string): CmrComparison[] {
  const others = receptions.filter(row => row.vehicleCategory === 'OTHER' && dateKey(row.receptionDate).startsWith(month))
  const linked = new Map(links.map(link => [link.jobId, link]))
  const confirmed = new Map<string, CmrDocument[]>()
  const unpaired: CmrDocument[] = []
  for (const doc of documents) {
    const link = linked.get(doc.id)
    const reception = others.find(row => row.receptionId === link?.receptionId)
    if (link?.status === 'CONFIRMED' && reception && matches(doc, reception)) {
      confirmed.set(reception.receptionId, [...(confirmed.get(reception.receptionId) || []), doc])
    } else unpaired.push(doc)
  }
  const rows: CmrComparison[] = others.map(reception => {
    const docs = confirmed.get(reception.receptionId) || []
    const suggestions = unpaired.filter(doc => matches(doc, reception) || linked.get(doc.id)?.receptionId === reception.receptionId)
    const needsReview = suggestions.some(doc => linked.get(doc.id)?.receptionId === reception.receptionId)
    let status: CmrComparisonStatus = needsReview ? 'needs_review' : suggestions.length ? 'match_available' : 'only_scale'
    let difference: number | null = null
    const unit = docs.length === 1 ? docs[0].quantityUnit || null : null
    // More than one confirmed CMR must not compare the same scale weight twice.
    if (docs.length > 1) status = 'needs_review'
    else if (docs.length === 1) {
      const doc = docs[0]
      const scale = numberOrNull(unit === 'kg' ? reception.netQuantityKg : reception.calculatedLiters)
      if (needsReview || !unit || doc.jobStatus !== 'completed' || doc.reviewStatus !== 'reviewed' || numberOrNull(doc.quantity) === null) status = 'needs_review'
      else if (numberOrNull(reception.fullTruckWeightKg) === null || numberOrNull(reception.emptyTruckWeightKg) === null || scale === null) status = 'awaiting_weight'
      else {
        difference = scale - Number(doc.quantity)
        status = Math.abs(difference) > 0.000001 ? 'difference' : 'linked'
      }
    }
    return { id: `reception-${reception.receptionId}`, date: dateKey(reception.receptionDate), reception, documents: docs, suggestions, status, difference, unit }
  })
  for (const doc of unpaired.filter(doc => cmrDay(doc).startsWith(month))) {
    const status: CmrComparisonStatus = linked.has(doc.id) ? 'needs_review'
      : !dateKey(doc.documentDate) || !truckKey(doc.vehicleRegistration) ? 'missing_info'
      : others.some(row => matches(doc, row)) ? 'match_available' : 'only_cmr'
    rows.push({ id: `cmr-${doc.id}`, date: cmrDay(doc), reception: null, documents: [doc], suggestions: [], status, difference: null, unit: doc.quantityUnit || null })
  }
  return rows
}

export function cmrTotals(rows: CmrComparison[], kind: 'document' | 'difference') {
  const totals: { kg: number | null; L: number | null } = { kg: null, L: null }
  if (kind === 'document') {
    const docs = [...new Map(rows.flatMap(row => row.documents).map(doc => [doc.id, doc])).values()]
    for (const unit of ['kg', 'L'] as const) {
      const values = docs.filter(doc => doc.quantityUnit === unit).map(doc => numberOrNull(doc.quantity))
      if (values.length && !values.includes(null)) totals[unit] = values.reduce<number>((sum, value) => sum + Number(value), 0)
    }
  } else {
    for (const row of rows) if (row.unit && row.difference !== null) totals[row.unit] = (totals[row.unit] ?? 0) + row.difference
  }
  return totals
}
