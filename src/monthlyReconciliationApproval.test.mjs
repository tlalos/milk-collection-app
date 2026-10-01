import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const built = await build({ entryPoints: ['src/monthlyReconciliationApproval.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { journalAvizIssueSeverity } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const row = { id: 'group1', month: '2026-08', milkType: 'MILK-COW', monthlyRowCount: 0, avizPricing: { centerCode: 'c1' } }
const issue = { id: 'journal-aviz-group1', type: 'missing_journal_group' }
const approval = { status: 'APPROVED', monthKey: '2026-08', centerCode: 'C1', milkType: 'MILK-COW' }

test('only an active matching approval downgrades a missing journal', () => {
  assert.equal(journalAvizIssueSeverity(issue, [row], [approval]), 'warning')
  assert.equal(journalAvizIssueSeverity(issue, [row], []), 'error')
  for (const change of [{ status: 'CANCELLED' }, { status: 'NEEDS_REVIEW' }, { monthKey: '2026-09' }, { centerCode: 'c2' }, { milkType: 'MILK-BUFF' }]) {
    assert.equal(journalAvizIssueSeverity(issue, [row], [{ ...approval, ...change }]), 'error')
  }
})

test('approval does not downgrade unrelated or invalid groups', () => {
  for (const type of ['missing_aviz_group', 'journal_header_center_conflict']) {
    assert.equal(journalAvizIssueSeverity({ ...issue, type }, [row], [approval]), 'error')
  }
  for (const change of [{ id: 'other' }, { monthlyRowCount: 1 }, { avizPricing: {} }, { avizPricing: { centerCode: 'c1', reason: 'Changed' } }, { avizPricing: { centerCode: 'c1', centerMatchWarning: 'Mismatch' } }]) {
    assert.equal(journalAvizIssueSeverity(issue, [{ ...row, ...change }], [approval]), 'error')
  }
})
