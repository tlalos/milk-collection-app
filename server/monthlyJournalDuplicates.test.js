import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyJournalDuplicateGroups } from './monthlyJournalDuplicates.js'

const options = {
  monthKey: job => job.data.date?.slice(0, 7),
  normalizeName: value => value.trim().replace(/\s+/gu, ' ').toUpperCase(),
  normalizeMilkType: value => value === 'VACA' ? 'MILK-COW' : value,
}
const job = (id, date, rows) => ({ id, documentCategory:'journal_monthly_settlement', data:{date, rows} })
const row = (rowNumber, producer = 'RUS MARIA', milkType = 'MILK-COW') => ({ rowNumber, producer, milkType })
test('duplicates span documents in the same month and normalize names and milk types', () => {
  const groups = monthlyJournalDuplicateGroups([
    job('a', '2026-08-01', [row(1)]), job('b', '2026-08-31', [row(20, ' rus  maria ', 'VACA')]),
  ], options)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].entries.map(entry => entry.job.id), ['a', 'b'])
})
test('different months, producers, and milk types are separate', () => {
  assert.deepEqual(monthlyJournalDuplicateGroups([
    job('a','2026-08-01',[row(1), row(2,'OTHER'), row(3,'RUS MARIA','MILK-BUFF')]),
    job('b','2026-09-01',[row(1)]),
  ], options), [])
})
test('duplicates within one document also count; daily jobs and blank names do not', () => {
  const groups = monthlyJournalDuplicateGroups([
    job('a','2026-08-01',[row(1),row(2),row(3,''),row(4,'')]),
    {...job('daily','2026-08-01',[row(1)]), documentCategory:'daily_routes'},
  ], options)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].entries.length, 2)
})
