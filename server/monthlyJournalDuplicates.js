// Scan the whole month, including journals from different centers/documents.
export function monthlyJournalDuplicateGroups(jobs, { monthKey, normalizeName, normalizeMilkType }) {
  const groups = new Map()
  for (const job of jobs) {
    if (job.documentCategory !== 'journal_monthly_settlement') continue
    const month = monthKey(job)
    if (!month) continue
    for (const row of job.data?.rows || []) {
      const producer = normalizeName(row.producer || row.centerName || '')
      const milkType = normalizeMilkType(row.milkType || job.data?.milkType)
      if (!producer || !milkType) continue
      const key = JSON.stringify([month, producer, milkType])
      if (!groups.has(key)) groups.set(key, { key, month, milkType, entries: [] })
      groups.get(key).entries.push({ job, row })
    }
  }
  return [...groups.values()].filter(group => group.entries.length > 1)
}
