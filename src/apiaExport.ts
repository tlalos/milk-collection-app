export const apiaColumns = [
  { key: 'producer', label: 'Nume si prenume/ Denumire producator', width: 260 },
  { key: 'country', label: 'Tara', width: 90 },
  { key: 'county', label: 'Judet', width: 100 },
  { key: 'taxId', label: 'CNP/CUI', width: 140 },
  { key: 'exploitationCode', label: 'Cod exploatatie', width: 140 },
  { key: 'contractNumber', label: 'Numar contract', width: 100 },
  { key: 'contractStartDate', label: 'Data incheierii contractului\nzz/ll/aaaa', width: 140 },
  { key: 'contractEndDate', label: 'Data incetarii contractului\nzz/ll/aaaa', width: 140 },
  { key: 'contractedKg', label: 'Cantitate de lapte contractata(total - kg)', width: 145 },
  { key: 'purchasedKg', label: 'Cantitate de lapte achizitionata - kg', width: 145 },
  { key: 'apiaCode', label: 'Cod unic identificare APIA', width: 140 },
  { key: 'fatPercent', label: 'Procent de grasime (%)', width: 110 },
  { key: 'proteinPercent', label: 'Procent de proteina (%)', width: 110 },
  { key: 'organic', label: 'Este lapte ecologic? (DA sau NU)', width: 130 },
] as const

export interface ApiaJournalGroup {
  month: string
  milkType?: string
  monthlyRows: {
    id: string
    producer: string | null
    producerCode?: string | null
    liters: number | null
    producerWarning?: string | null
  }[]
}

export interface ApiaProducerRow {
  id: string
  producer: string
  producerCode: string
  country: null
  county: string | null
  taxId: string | null
  exploitationCode: string | null
  purchasedKg: number | null
  litersByMilkType: Record<string, number>
  missingReceptionFactor: boolean
  warning: string | null
  source: 'journal' | 'aviz'
  contractNumber: string | null
  contractStartDate: string | null
  contractEndDate: string | null
  contractedKg: number | null
  contractWarning: 'missing' | 'partial' | 'multiple' | 'mixed-milk-types' | null
}

export interface ApiaProducerContract {
  producerCode: string
  milkType: string
  contractNumber: string
  contractStartDate: string
  contractEndDate: string
  contractedKg: number
}

const emptyContract = { contractNumber: null, contractStartDate: null, contractEndDate: null, contractedKg: null, contractWarning: null }

export function selectApiaContract(contracts: ApiaProducerContract[], month: string, milkTypes: string[]) {
  if (milkTypes.length !== 1) return { ...emptyContract, contractWarning: 'mixed-milk-types' as const }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ...emptyContract, contractWarning: 'missing' as const }
  const first = `${month}-01`
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10)
  const overlapping = contracts.filter(contract => contract.milkType === milkTypes[0] && contract.contractStartDate <= last && contract.contractEndDate >= first)
  if (!overlapping.length) return { ...emptyContract, contractWarning: 'missing' as const }
  if (overlapping.length > 1) return { ...emptyContract, contractWarning: 'multiple' as const }
  const contract = overlapping[0]
  if (contract.contractStartDate > first || contract.contractEndDate < last) return { ...emptyContract, contractWarning: 'partial' as const }
  return { contractNumber: contract.contractNumber, contractStartDate: contract.contractStartDate, contractEndDate: contract.contractEndDate, contractedKg: contract.contractedKg, contractWarning: null }
}

export interface ApiaAvizApproval {
  approvalId: string
  monthKey: string
  producerName: string
  producerCode: string
  milkType: string
  approvedLiters: number
  status: string
}

export interface ApiaProducerReference {
  producerCode: string
  county?: string
  trn?: string
  exploitationCode?: string
}

export interface ApiaReceptionFactor {
  code: string
  densityFactor: number
}

export function buildApiaProducerList(groups: ApiaJournalGroup[], month: string, milkType = '', approvals: ApiaAvizApproval[] = [], references: ApiaProducerReference[] = [], factors: ApiaReceptionFactor[] = [], contracts: ApiaProducerContract[] = []): ApiaProducerRow[] {
  const producers = new Map<string, Omit<ApiaProducerRow, 'litersByMilkType'>>()
  const quantities = new Map<string, Map<string, number>>()
  const journalKeys = new Set<string>()
  const approvalKeys = new Set<string>()
  function addLiters(id: string, type: string, liters: number) {
    const byType = quantities.get(id) || new Map<string, number>()
    byType.set(type, (byType.get(type) || 0) + liters)
    quantities.set(id, byType)
  }
  for (const group of groups) {
    if (group.month !== month) continue
    if (milkType && group.milkType !== milkType) continue
    for (const row of group.monthlyRows) {
      if (typeof row.liters !== 'number' || !Number.isFinite(row.liters) || row.liters <= 0) continue
      const code = String(row.producerCode || '').trim()
      const linked = /^p\S+$/iu.test(code)
      // Unmatched rows stay separate; identical OCR names do not establish identity.
      const id = linked ? `producer:${code.toLowerCase()}` : `journal:${row.id}`
      const type = group.milkType || ''
      journalKeys.add(JSON.stringify([id, type]))
      addLiters(id, type, row.liters)
      const warning = !linked ? 'No ERP match' : row.producerWarning || null
      const existing = producers.get(id)
      if (existing) {
        existing.warning ||= warning
        continue
      }
      producers.set(id, {
        ...emptyContract, id, producer: String(row.producer || '').trim(), producerCode: linked ? code : '',
        country: null, county: null, taxId: null, exploitationCode: null, purchasedKg: null, missingReceptionFactor: false, warning, source: 'journal',
      })
    }
  }
  for (const approval of approvals) {
    if (approval.status !== 'APPROVED' || approval.monthKey !== month) continue
    if (milkType && approval.milkType !== milkType) continue
    if (!Number.isFinite(approval.approvedLiters) || approval.approvedLiters <= 0) continue
    const code = String(approval.producerCode || '').trim()
    const linked = /^p\S+$/iu.test(code)
    const id = linked ? `producer:${code.toLowerCase()}` : `approval:${approval.approvalId}`
    const quantityKey = JSON.stringify([id, approval.milkType])
    // Journal quantities take precedence over an approval for the same producer and milk type.
    if (journalKeys.has(quantityKey) || approvalKeys.has(quantityKey)) continue
    approvalKeys.add(quantityKey)
    addLiters(id, approval.milkType, approval.approvedLiters)
    if (producers.has(id)) continue
    producers.set(id, {
      ...emptyContract, id, producer: String(approval.producerName || '').trim(), producerCode: linked ? code : '',
      country: null, county: null, taxId: null, exploitationCode: null, purchasedKg: null, missingReceptionFactor: false, warning: linked ? null : 'No ERP match', source: 'aviz',
    })
  }
  const referenceByCode = new Map(references.map(reference => [reference.producerCode.trim().toLowerCase(), reference]))
  const factorByType = new Map(factors.map(factor => [factor.code, factor.densityFactor]))
  const contractsByCode = new Map<string, ApiaProducerContract[]>()
  for (const contract of contracts) {
    const key = contract.producerCode.trim().toLowerCase()
    contractsByCode.set(key, [...(contractsByCode.get(key) || []), contract])
  }
  return [...producers.values()].map(row => {
    const reference = row.producerCode ? referenceByCode.get(row.producerCode.toLowerCase()) : undefined
    let purchasedKg = 0
    let missingReceptionFactor = false
    for (const [type, liters] of quantities.get(row.id) || []) {
      const factor = factorByType.get(type)
      if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) missingReceptionFactor = true
      else purchasedKg += liters * factor
    }
    const contract = selectApiaContract(contractsByCode.get(row.producerCode.toLowerCase()) || [], month, [...(quantities.get(row.id)?.keys() || [])])
    return { ...row, ...contract, county: reference?.county?.trim() || null, taxId: reference?.trn?.trim() || null, exploitationCode: reference?.exploitationCode?.trim() || null,
      purchasedKg: missingReceptionFactor ? null : purchasedKg, missingReceptionFactor,
      litersByMilkType: Object.fromEntries(quantities.get(row.id) || []) }
  }).sort((a, b) => a.producer.localeCompare(b.producer, 'ro', { numeric: true }) || a.id.localeCompare(b.id))
}
