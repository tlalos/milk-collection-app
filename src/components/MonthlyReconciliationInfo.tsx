import { useState } from 'react'

export function MonthlyReconciliationInfo() {
  const [view, setView] = useState<'user' | 'developer'>('user')
  return (
    <section id="monthly-recon-info" className="monthly-recon-info" aria-labelledby="monthly-recon-info-title">
      <div className="monthly-recon-info-heading">
        <h2 id="monthly-recon-info-title">About Monthly Reconciliation</h2>
        <div className="monthly-recon-info-switch" role="group" aria-label="Information view">
          <button type="button" aria-pressed={view === 'user'} onClick={() => setView('user')}>User</button>
          <button type="button" aria-pressed={view === 'developer'} onClick={() => setView('developer')}>Developer</button>
        </div>
      </div>
      {view === 'user' ? (
        <div className="monthly-recon-info-body">
          <h3>What is compared?</h3>
          <p>Daily aviz liters are compared with monthly journal liters for the same month, collection center, and milk type. Cow and buffalo milk are compared separately.</p>
          <h3>Reading the results</h3>
          <ul>
            <li><strong>Difference:</strong> monthly journal liters minus aviz liters. A negative value means the journal has fewer liters.</li>
            <li><strong>OK:</strong> both sources exist and their totals differ by no more than 10 liters.</li>
            <li><strong>No journal / Missing aviz:</strong> one side of the comparison is absent. The main table shows centers with aviz; Journals also includes journal-only centers.</li>
          </ul>
          <h3>Checking an issue</h3>
          <p>Choose the month and filters, then expand a center to inspect its source rows and files. OCR issues separates monthly journal checks, journals vs aviz checks, and daily aviz checks. These can identify unmatched names, wrong centers, duplicate producer and milk-type entries within a month, and missing counterparts.</p>
          <h3>Approving aviz for pricing</h3>
          <p>For an eligible center without a journal, an authorized user can approve aviz liters for the identified ERP producer. This allows those liters into Month Closure without creating a journal.</p>
          <p>The center displays Approved, but No journal remains visible. In Journals vs aviz, an actively approved missing journal is a Warning; unresolved issues are Errors. Canceling approval removes that exception. An approval needing review is not treated as active.</p>
        </div>
      ) : (
        <div className="monthly-recon-info-body">
          <h3>Data sources and grouping</h3>
          <p><code>GET /api/ocr/monthly-reconciliation/rows</code> loads the comparison and approval context. <code>monthlyReconciliationFromJobs</code> in <code>server/index.js</code> aggregates saved OCR jobs in categories <code>daily_routes</code> and <code>journal_monthly_settlement</code>, grouped by month, normalized center, and milk type.</p>
          <p>Daily rows provide aviz liters. Monthly rows provide journal liters; a document total is used as a fallback when no journal rows exist. Journal centers resolve from the header name, saved header selection, then row center. Producer selections are checked against the current row name before being used.</p>
          <h3>Status calculation</h3>
          <p><code>differenceLiters = monthlyLiters - avizLiters</code>. Missing-side checks take precedence; otherwise an absolute difference greater than 10 liters is Difference. Percentage uses aviz liters as the denominator and is unavailable when that total is zero.</p>
          <h3>Issues and approval state</h3>
          <p><code>GET /api/ocr/issues</code> supplies the issue list. <code>server/journalAvizIssues.js</code> identifies missing month/center/milk-type counterparts and journal header conflicts.</p>
          <p><code>src/monthlyReconciliationApproval.ts</code> applies the UI severity rule: only a missing-journal issue with a matching active APPROVED record for month, ERP center code, and milk type becomes Warning. The group must still have no journal and no approval eligibility or center-match warning. Other issues remain Error; the original reconciliation status is unchanged.</p>
          <p><code>POST /api/monthly-reconciliation/aviz-pricing</code> creates or cancels approvals. SQL stores them in <code>MonthlyAvizPricingApprovals</code> and their source lines in <code>MonthlyAvizPricingApprovalLines</code>. Approval changes reload the comparison; severity is derived from the current approval context.</p>
          <h3>Page state</h3>
          <p>The month comes from a valid <code>?month=YYYY-MM</code> parameter or the current local month. Main-table filters apply to comparison rows; OCR issues are filtered by month. The main table includes only groups with aviz rows. Refresh reloads both comparison data and OCR issues.</p>
        </div>
      )}
    </section>
  )
}
