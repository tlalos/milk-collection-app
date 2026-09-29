const normalized = value => String(value || '').trim().replace(/\s+/gu, ' ').toUpperCase()

export function journalAvizIssues(groups, jobs, monthKey) {
  const issues = []
  const base = { source: 'reconciliation', jobId: '', sourceFile: '', fileUrl: '', documentDate: null,
    rowNumber: null, producer: null, headerCenter: null, referenceCenter: null, noticeNumber: null }
  for (const group of groups) {
    const journalOnly = group.monthlyRowCount > 0 && group.avizLineCount === 0
    const avizOnly = group.avizLineCount > 0 && group.monthlyRowCount === 0
    if (!journalOnly && !avizOnly) continue
    const otherTypes = [...new Set(groups.filter(other => other.month === group.month &&
      normalized(other.center) === normalized(group.center) && other.milkType !== group.milkType &&
      (journalOnly ? other.avizLineCount > 0 : other.monthlyRowCount > 0)).map(other => other.milkType))]
    const counterpart = journalOnly ? 'aviz' : 'journal'
    issues.push({ ...base, id: `journal-aviz-${group.id}`, type: `missing_${counterpart}_group`,
      month: group.month, center: group.center, milkType: group.milkType,
      liters: journalOnly ? group.monthlyLiters : group.avizLiters,
      problem: `No matching ${counterpart} for this month, center and milk type.` +
        (otherTypes.length ? ` ${journalOnly ? 'Aviz' : 'Journals'} exist for ${otherTypes.join(', ')}. Check the milk types.` : ''),
    })
  }
  for (const job of jobs) {
    if (job.documentCategory !== 'journal_monthly_settlement') continue
    const header = job.data?.headerCenterName
    const selected = job.headerCenterMatch?.selectedName
    if (!header || !selected || !job.headerCenterMatch?.selectedCode || normalized(header) === normalized(selected)) continue
    issues.push({ ...base, id: `journal-header-conflict-${job.id}`, type: 'journal_header_center_conflict',
      jobId: job.id, sourceFile: job.sourceFile || '', month: monthKey(job), documentDate: job.data?.date || null,
      center: header, headerCenter: header, referenceCenter: selected, milkType: job.data?.milkType || null,
      liters: job.data?.totalLiters ?? null,
      problem: `Journal header "${header}" differs from saved ERP center "${selected}" (${job.headerCenterMatch.selectedCode}). This can prevent matching with aviz.`,
    })
  }
  return issues
}
