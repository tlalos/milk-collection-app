export type BankSummaryRow = {
  id: string
  producerCode: string
  producerName: string
  centers: string[]
  status: string
  finalAmount: number | null
  paymentProducer?: { iban?: string | null } | null
}

type CenterVolume = { month: string; center: string; liters: number }
type GroupKey = 'above' | 'remaining' | 'unassigned'
const normalize = (value: string) => value.trim().toLocaleLowerCase('ro')

export function summarizeBankNote(month: string, volumes: CenterVolume[], payments: BankSummaryRow[]) {
  const centerLiters = new Map<string, number>()
  for (const row of volumes) {
    if (row.month !== month) continue
    const center = normalize(row.center)
    if (center) centerLiters.set(center, (centerLiters.get(center) ?? 0) + row.liters)
  }
  const groups = (['above', 'remaining', 'unassigned'] as GroupKey[]).map(key => ({
    key, pendingCents: 0, readyCents: 0, rows: 0, blocked: new Set<string>(),
  }))
  const blocked = new Set<string>()
  let missingAmountRows = 0
  for (const row of payments) {
    if (row.status === 'sent') continue
    const center = normalize(row.centers[0] ?? '')
    const key: GroupKey = !center || !centerLiters.has(center)
      ? 'unassigned' : centerLiters.get(center)! > 5000 ? 'above' : 'remaining'
    const group = groups.find(candidate => candidate.key === key)!
    const cents = row.finalAmount === null ? null : Math.round(row.finalAmount * 100)
    group.rows++
    group.pendingCents += cents ?? 0
    if (row.paymentProducer?.iban && cents !== null) {
      group.readyCents += cents
    } else {
      const producer = normalize(row.producerCode)
        ? `code:${normalize(row.producerCode)}`
        : normalize(row.producerName) ? `name:${normalize(row.producerName)}` : `row:${row.id}`
      group.blocked.add(producer)
      blocked.add(producer)
    }
    if (cents === null) missingAmountRows++
  }
  return {
    groups: groups.filter(group => group.key !== 'unassigned' || group.rows > 0).map(group => ({
      key: group.key, pendingAmount: group.pendingCents / 100, readyAmount: group.readyCents / 100,
      blockedProducers: group.blocked.size, rows: group.rows,
    })),
    blockedProducers: blocked.size,
    missingAmountRows,
  }
}
