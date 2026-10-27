export interface CenterSummarySource {
  id: string
  month: string
  center: string
  producerCode: string
  producer: string
  liters: number
  milkType: string
  readyForPricing: boolean
}

export type JournalProducer = Pick<CenterSummarySource, 'id' | 'center' | 'producerCode' | 'producer'>
export interface ReceptionFactor { code: string; densityFactor: number }

const normalize = (value: string) => value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ro')
const roundLiters = (value: number) => Math.round(value * 1000) / 1000

export function summarizeClosureCenters(month: string, rows: CenterSummarySource[], journalProducers: JournalProducer[], factors: ReceptionFactor[]) {
  const centers = new Map<string, { center: string; people: Set<string>; readyLiters: number; blockedLiters: number; estimatedKg: number; missingFactor: boolean }>()
  const factorByCode = new Map(factors.map(factor => [factor.code, factor.densityFactor]))
  const people = new Set<string>()
  for (const row of rows) {
    if (row.month !== month) continue
    const key = normalize(row.center || '')
    const group = centers.get(key) ?? { center: row.center.trim() || 'Unassigned center', people: new Set<string>(), readyLiters: 0, blockedLiters: 0, estimatedKg: 0, missingFactor: false }
    const liters = Number.isFinite(row.liters) ? row.liters : 0
    if (row.readyForPricing) group.readyLiters += liters
    else group.blockedLiters += liters
    const factor = factorByCode.get(row.milkType)
    if (liters !== 0) {
      if (factor !== undefined && Number.isFinite(factor) && factor > 0) group.estimatedKg += liters * factor
      else group.missingFactor = true
    }
    centers.set(key, group)
  }
  // Counts use journals for the full selected month, never ERP membership or approval rows.
  for (const row of journalProducers) {
    const group = centers.get(normalize(row.center || ''))
    if (!group) continue
    const producer = row.producerCode.trim() ? `code:${normalize(row.producerCode)}`
      : row.producer.trim() ? `name:${normalize(row.producer)}` : `row:${row.id}`
    group.people.add(producer)
    people.add(producer)
  }
  const groups = [...centers.entries()].map(([key, group]) => ({
    key, center: group.center, producerCount: group.people.size,
    readyLiters: roundLiters(group.readyLiters), blockedLiters: roundLiters(group.blockedLiters),
    totalLiters: roundLiters(group.readyLiters + group.blockedLiters),
    estimatedKg: group.missingFactor ? null : roundLiters(group.estimatedKg),
  })).sort((a, b) => a.center.localeCompare(b.center, 'ro', { numeric: true }))
  return { groups, producerCount: people.size,
    readyLiters: roundLiters(groups.reduce((sum, group) => sum + group.readyLiters, 0)),
    blockedLiters: roundLiters(groups.reduce((sum, group) => sum + group.blockedLiters, 0)),
    totalLiters: roundLiters(groups.reduce((sum, group) => sum + group.totalLiters, 0)),
    estimatedKg: groups.some(group => group.estimatedKg === null) ? null : roundLiters(groups.reduce((sum, group) => sum + (group.estimatedKg ?? 0), 0)),
  }
}
