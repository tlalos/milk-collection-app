import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMonthlyAvizApprovalSnapshot } from './monthlyAvizPricingApprovalStore.js'

function input() {
  return { monthKey: '2026-08', centerCode: 'C001', milkType: 'MILK-COW', hasJournal: false,
    producers: [{ producerCode: 'P001', centerCode: 'c001' }],
    lines: [{ jobId: 'a', rowNumber: 1, documentDate: '2026-08-02', noticeNumber: '123', liters: 200 },
      { jobId: 'b', rowNumber: 1, documentDate: '2026-08-03', noticeNumber: '124', liters: 300 }] }
}

test('sums snapshots and uses ERP code matching', () => {
  const snapshot = buildMonthlyAvizApprovalSnapshot(input())
  assert.equal(snapshot.approvedLiters, 500)
  assert.equal(snapshot.producerCode, 'p001')
  assert.equal(snapshot.lines.length, 2)
})

test('source ordering does not alter fingerprint', () => {
  const value = input()
  const before = buildMonthlyAvizApprovalSnapshot(value)
  value.lines.reverse()
  assert.equal(buildMonthlyAvizApprovalSnapshot(value).sourceFingerprint, before.sourceFingerprint)
})

test('changed, added, or removed source lines and changed producer alter fingerprint', () => {
  const original = buildMonthlyAvizApprovalSnapshot(input()).sourceFingerprint
  for (const modify of [v => { v.lines[0].liters++ }, v => { v.lines.pop() },
    v => { v.lines[0].noticeNumber = 'changed' }, v => { v.lines[0].documentDate = '2026-08-10' },
    v => { v.lines.push({ ...v.lines[0], jobId: 'new' }) }, v => { v.producers[0].producerCode = 'p002' }]) {
    const value = input()
    modify(value)
    assert.notEqual(buildMonthlyAvizApprovalSnapshot(value).sourceFingerprint, original)
  }
})

test('rejects journals and ambiguous or missing ERP relationships', () => {
  for (const modify of [v => { v.hasJournal = true }, v => { v.producers = [] },
    v => { v.producers.push({ producerCode: 'p002', centerCode: 'C001' }) },
    v => { v.centerCode = '' }]) {
    const value = input()
    modify(value)
    assert.throws(() => buildMonthlyAvizApprovalSnapshot(value))
  }
})

test('rejects duplicate lines, invalid dates and invalid quantities', () => {
  for (const modify of [v => { v.lines.push(v.lines[0]) }, v => { v.lines = [] },
    v => { v.lines[0].liters = null }, v => { v.lines[0].liters = -1 },
    v => { v.lines[0].liters = 1.0001 }, v => { v.lines[0].documentDate = '2026-09-01' },
    v => { v.lines[0].documentDate = '2026-08-32' }]) {
    const value = input()
    modify(value)
    assert.throws(() => buildMonthlyAvizApprovalSnapshot(value))
  }
})
