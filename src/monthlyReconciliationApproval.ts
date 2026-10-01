interface ApprovalGroup {
  id: string
  month: string
  milkType: string
  monthlyRowCount: number
  avizPricing?: { centerCode?: string; reason?: string; centerMatchWarning?: string | null }
}

interface Approval {
  status: string
  monthKey: string
  centerCode: string
  milkType: string
}

export function isApprovedForAvizPricing(row: ApprovalGroup, approvals: Approval[]) {
  return row.monthlyRowCount === 0 && Boolean(row.avizPricing?.centerCode) &&
    !row.avizPricing?.reason && !row.avizPricing?.centerMatchWarning &&
    approvals.some(approval => approval.status === 'APPROVED' &&
      approval.monthKey === row.month && approval.milkType === row.milkType &&
      approval.centerCode.toLowerCase() === row.avizPricing?.centerCode?.toLowerCase())
}

export function journalAvizIssueSeverity(issue: { id: string; type: string }, rows: ApprovalGroup[], approvals: Approval[]): 'warning' | 'error' {
  const approved = issue.type === 'missing_journal_group' && rows.some(row =>
    issue.id === `journal-aviz-${row.id}` && isApprovedForAvizPricing(row, approvals))
  return approved ? 'warning' : 'error'
}
