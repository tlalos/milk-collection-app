import { buildApiaProducerList, type ApiaAvizApproval, type ApiaJournalGroup, type ApiaProducerReference } from './apiaExport'

export const veterinaryAnimalGroups = [
  { key: 'cow', label: 'Exploatatii de vaci de lapte', countLabel: 'Efectiv matca vaci de lapte (capete)', types: ['MILK-COW'] },
  { key: 'buffalo', label: 'Exploatatii de bivolite', countLabel: 'Efectiv matca bivolite (capete)', types: ['MILK-BUFF'] },
  { key: 'sheepGoat', label: 'Exploatatii de oi/capre', countLabel: 'Efectiv matca oi/capre (capete)', types: ['MILK-SHEEP', 'MILK-GOAT'] },
] as const

export type VeterinaryAnimalGroup = typeof veterinaryAnimalGroups[number]['key']

export interface VeterinaryHerdCount {
  producerCode: string
  effectiveMonth: string
  cowCount: number | null
  buffaloCount: number | null
  sheepGoatCount: number | null
  version?: string
}

export interface VeterinaryProducerRow {
  id: string
  producer: string
  producerCode: string
  county: string | null
  taxId: string | null
  warning: string | null
  source: 'journal' | 'aviz'
  animalGroups: VeterinaryAnimalGroup[]
  liters: Record<VeterinaryAnimalGroup, number>
  animalCounts: Record<VeterinaryAnimalGroup, number | null>
  countEffectiveMonth: string | null
  countVersion: string | null
  hasUnclassifiedMilk: boolean
}

export function buildVeterinaryProducerList(groups: ApiaJournalGroup[], month: string, approvals: ApiaAvizApproval[] = [], references: ApiaProducerReference[] = [], herdCounts: VeterinaryHerdCount[] = []): VeterinaryProducerRow[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return []
  const activeCounts = new Map<string, VeterinaryHerdCount>()
  for (const count of herdCounts) {
    const code = count.producerCode.trim().toLowerCase()
    if (!code || !/^\d{4}-(0[1-9]|1[0-2])$/.test(count.effectiveMonth) || count.effectiveMonth > month) continue
    if (!activeCounts.has(code) || activeCounts.get(code)!.effectiveMonth < count.effectiveMonth) activeCounts.set(code, count)
  }
  // Reuse APIA's month, producer identity and approved-aviz rules, without requiring contracts or density factors.
  return buildApiaProducerList(groups, month, '', approvals, references).map(row => {
    const liters = { cow: 0, buffalo: 0, sheepGoat: 0 }
    const herd = activeCounts.get(row.producerCode.trim().toLowerCase())
    const validCount = (count: number | null | undefined) => count != null && Number.isInteger(count) && count >= 0 ? count : null
    const animalCounts = { cow: validCount(herd?.cowCount), buffalo: validCount(herd?.buffaloCount), sheepGoat: validCount(herd?.sheepGoatCount) }
    const classifiedTypes = new Set<string>()
    for (const animal of veterinaryAnimalGroups) {
      for (const type of animal.types) {
        classifiedTypes.add(type)
        liters[animal.key] += row.litersByMilkType[type] || 0
      }
    }
    return {
      id: row.id, producer: row.producer, producerCode: row.producerCode, county: row.county, taxId: row.taxId,
      warning: row.warning, source: row.source, liters, animalCounts,
      countEffectiveMonth: herd?.effectiveMonth || null, countVersion: herd?.version || null,
      animalGroups: veterinaryAnimalGroups.filter(animal => liters[animal.key] > 0).map(animal => animal.key),
      hasUnclassifiedMilk: Object.keys(row.litersByMilkType).some(type => !classifiedTypes.has(type)),
    }
  })
}

export function hasMissingVeterinaryCounts(row: VeterinaryProducerRow) {
  return !row.animalGroups.length || row.animalGroups.some(animal => row.animalCounts[animal] == null)
}
