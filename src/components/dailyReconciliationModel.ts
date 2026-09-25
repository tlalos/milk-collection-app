export type ReceptionCategory = 'COLLECTION' | 'OTHER'
export type MatchStatus = 'within_range' | 'difference' | 'no_aviz' | 'awaiting_weight' | 'review' | 'missing_info' | 'conflict'
export type UnmatchedStatus = 'no_scale' | 'missing_info' | 'conflict'

export interface ReceptionRow {
  receptionId: string
  receptionDate: string
  vehicleRegistration: string
  vehicleCategory: string
  routeId: string
  milkTypeLabel: string
  driverName: string
  fullTruckWeightKg: number | null
  fullTruckWeighedAt: string | null
  fullTruckWeightSource: 'SCALE' | 'MANUAL' | null
  emptyTruckWeightKg: number | null
  emptyTruckWeighedAt: string | null
  emptyTruckWeightSource: 'SCALE' | 'MANUAL' | null
  netQuantityKg: number | null
  calculatedLiters: number | null
  comments: string
}

export interface AvizLine {
  rowIndex: number
  rowNumber: number | null
  noticeNumber: string | null
  collectionCenter: string | null
  liters: number | null
}

export interface AvizDocument {
  id: string
  sourceFile: string
  fileUrl: string
  documentDate: string | null
  createdAt: string
  vehicleRegistration: string | null
  route: string | null
  jobStatus: string
  reviewStatus: string
  rows: AvizLine[]
}

export interface SavedLink {
  jobId: string
  rowIndex: number
  receptionId: string
  linkedAt: string | null
}

export interface CollectionComparison {
  reception: ReceptionRow
  documents: AvizDocument[]
  savedLinkCount: number
  avizLiters: number | null
  differenceLiters: number | null
  status: MatchStatus
}

export interface UnmatchedDocument {
  document: AvizDocument
  status: UnmatchedStatus
}

export interface ReconciliationDay {
  date: string
  comparisons: CollectionComparison[]
  unmatched: UnmatchedDocument[]
  others: ReceptionRow[]
  documentCount: number
  scaleLiters: number | null
  avizLiters: number | null
  missingAvizCount: number
  unmatchedAvizCount: number
  differenceCount: number
  attentionCount: number
}

export interface MonthlyReconciliation {
  days: ReconciliationDay[]
  comparisons: CollectionComparison[]
  unmatched: UnmatchedDocument[]
  others: ReceptionRow[]
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function dateKey(value: string | null | undefined): string {
  if (!value) return ''
  const iso = /^(\d{4}-\d{2}-\d{2})/u.exec(value)
  if (iso) return iso[1]
  const display = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/u.exec(value)
  return display ? `${display[3]}-${display[2].padStart(2, '0')}-${display[1].padStart(2, '0')}` : ''
}

export function documentDay(document: AvizDocument): string {
  return dateKey(document.documentDate) || dateKey(document.createdAt)
}

function matchKey(date: string | null | undefined, truck: string | null | undefined, route: string | null | undefined) {
  const normalized = (value: string | null | undefined) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase().replace(/[^A-Z0-9]+/gu, '')
  const day = dateKey(date)
  const vehicle = normalized(truck)
  const routeId = normalized(route)
  return day && vehicle && routeId ? `${day}|${vehicle}|${routeId}` : ''
}

function categoryOf(reception: ReceptionRow): ReceptionCategory {
  return reception.vehicleCategory?.toUpperCase() === 'OTHER' ? 'OTHER' : 'COLLECTION'
}

export function documentLiters(document: AvizDocument): number | null {
  if (!document.rows.length || document.rows.some((row) => numberOrNull(row.liters) === null)) return null
  return document.rows.reduce((total, row) => total + Number(row.liters), 0)
}

function totalIfComplete(values: Array<number | null>): number | null {
  return values.some((value) => value === null) ? null : values.reduce<number>((total, value) => total + Number(value), 0)
}

export function buildDailyReconciliation(
  receptions: ReceptionRow[], documents: AvizDocument[], savedLinks: SavedLink[], month: string,
): MonthlyReconciliation {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) return { days: [], comparisons: [], unmatched: [], others: [] }
  const monthReceptions = receptions.filter((row) => dateKey(row.receptionDate).startsWith(month))
  const collection = monthReceptions.filter((row) => categoryOf(row) === 'COLLECTION')
  const others = monthReceptions.filter((row) => categoryOf(row) === 'OTHER')
  const monthDocuments = documents.filter((document) => documentDay(document).startsWith(month))
  const linksByLine = new Map(savedLinks.map((link) => [`${link.jobId}:${link.rowIndex}`, link]))

  const receptionsByKey = new Map<string, ReceptionRow[]>()
  for (const reception of collection) {
    const key = matchKey(reception.receptionDate, reception.vehicleRegistration, reception.routeId)
    if (key) receptionsByKey.set(key, [...(receptionsByKey.get(key) || []), reception])
  }

  const documentsByReception = new Map<string, AvizDocument[]>()
  const unmatched: UnmatchedDocument[] = []
  for (const document of monthDocuments) {
    const key = matchKey(document.documentDate, document.vehicleRegistration, document.route)
    const matches = key ? receptionsByKey.get(key) || [] : []
    if (matches.length !== 1) {
      unmatched.push({ document, status: !key ? 'missing_info' : matches.length > 1 ? 'conflict' : 'no_scale' })
      continue
    }
    const receptionId = matches[0].receptionId
    documentsByReception.set(receptionId, [...(documentsByReception.get(receptionId) || []), document])
  }

  const comparisons: CollectionComparison[] = collection.map((reception) => {
    const key = matchKey(reception.receptionDate, reception.vehicleRegistration, reception.routeId)
    const matchedDocuments = documentsByReception.get(reception.receptionId) || []
    const scaleLiters = numberOrNull(reception.calculatedLiters)
    const avizLiters = matchedDocuments.length
      ? totalIfComplete(matchedDocuments.map(documentLiters))
      : null
    const differenceLiters = scaleLiters !== null && avizLiters !== null ? scaleLiters - avizLiters : null
    const savedLinkCount = matchedDocuments.reduce((total, document) => total + document.rows.filter((row) =>
      linksByLine.get(`${document.id}:${row.rowIndex}`)?.receptionId === reception.receptionId).length, 0)
    let status: MatchStatus = 'within_range'
    if (!key) status = 'missing_info'
    else if ((receptionsByKey.get(key) || []).length > 1) status = 'conflict'
    else if (!matchedDocuments.length) status = 'no_aviz'
    else if (numberOrNull(reception.fullTruckWeightKg) === null || numberOrNull(reception.emptyTruckWeightKg) === null || scaleLiters === null) status = 'awaiting_weight'
    else if (avizLiters === null || matchedDocuments.some((document) => document.reviewStatus !== 'reviewed' || document.jobStatus !== 'completed')) status = 'review'
    else if (differenceLiters !== null && Math.abs(differenceLiters) > 5) status = 'difference'
    return { reception, documents: matchedDocuments, savedLinkCount, avizLiters, differenceLiters, status }
  })

  return { days: groupReconciliationDays(comparisons, unmatched, others), comparisons, unmatched, others }
}

export function groupReconciliationDays(
  comparisons: CollectionComparison[], unmatched: UnmatchedDocument[], others: ReceptionRow[],
): ReconciliationDay[] {
  const dayMap = new Map<string, ReconciliationDay>()
  const dayFor = (date: string) => {
    if (!dayMap.has(date)) dayMap.set(date, {
      date, comparisons: [], unmatched: [], others: [], documentCount: 0,
      scaleLiters: 0, avizLiters: 0, missingAvizCount: 0, unmatchedAvizCount: 0,
      differenceCount: 0, attentionCount: 0,
    })
    return dayMap.get(date)!
  }
  for (const comparison of comparisons) dayFor(dateKey(comparison.reception.receptionDate)).comparisons.push(comparison)
  for (const item of unmatched) dayFor(documentDay(item.document)).unmatched.push(item)
  for (const reception of others) dayFor(dateKey(reception.receptionDate)).others.push(reception)

  const days = [...dayMap.values()].sort((left, right) => right.date.localeCompare(left.date))
  for (const day of days) {
    const allDocuments = [...day.comparisons.flatMap((comparison) => comparison.documents), ...day.unmatched.map((item) => item.document)]
    day.documentCount = allDocuments.length
    day.scaleLiters = totalIfComplete(day.comparisons.map((comparison) => numberOrNull(comparison.reception.calculatedLiters)))
    day.avizLiters = totalIfComplete(allDocuments.map(documentLiters))
    day.missingAvizCount = day.comparisons.filter((comparison) => comparison.status === 'no_aviz').length
    day.unmatchedAvizCount = day.unmatched.length
    day.differenceCount = day.comparisons.filter((comparison) => comparison.status === 'difference').length
    day.attentionCount = day.comparisons.filter((comparison) => comparison.status !== 'within_range').length + day.unmatched.length
  }
  return days
}
