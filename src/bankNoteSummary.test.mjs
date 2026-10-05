import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const built = await build({ entryPoints: ['src/bankNoteSummary.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { summarizeBankNote } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const month = '2026-08'
const volume = (center, liters, selectedMonth = month) => ({ center, liters, month: selectedMonth })
const payment = (id, center, finalAmount = 100, extra = {}) => ({
  id, producerCode: id, producerName: id, centers: [center], finalAmount,
  status: 'pending', paymentProducer: { iban: 'RO123' }, ...extra,
})
const group = (summary, key) => summary.groups.find(item => item.key === key)

test('centre volume combines all monthly rows, with a strict 5000 L boundary', () => {
  const result = summarizeBankNote(month, [volume(' A ', 3000), volume('a', 2001), volume('B', 5000), volume('B', 9999, '2026-07')], [payment('1', 'A'), payment('2', 'B', 200)])
  assert.equal(group(result, 'above').pendingAmount, 100)
  assert.equal(group(result, 'remaining').pendingAmount, 200)
})
test('filtered payments retain the full centre volume and use source centre, not payee', () => {
  const result = summarizeBankNote(month, [volume('A', 6000)], [payment('1', 'A', 150, { paymentProducer: { iban: 'RO456', center: 'B' } })])
  assert.equal(group(result, 'above').readyAmount, 150)
})
test('counts distinct blocked producers, excludes sent rows, and reports missing amounts', () => {
  const result = summarizeBankNote(month, [volume('A', 6000), volume('B', 10)], [
    payment('1', 'A', 10.1, { producerCode: 'p1', paymentProducer: null }),
    payment('2', 'B', null, { producerCode: ' P1 ' }),
    payment('3', 'A', 20.2), payment('4', 'A', 1000, { status: 'sent', paymentProducer: null }),
  ])
  assert.equal(result.blockedProducers, 1)
  assert.equal(result.missingAmountRows, 1)
  assert.equal(group(result, 'above').pendingAmount, 30.3)
  assert.equal(group(result, 'above').readyAmount, 20.2)
})
test('missing producer codes use names without merging all unknown producers', () => {
  const result = summarizeBankNote(month, [], [
    payment('1', '', null, { producerCode: '', producerName: 'Ana' }),
    payment('2', '', null, { producerCode: '', producerName: ' ANA ' }),
    payment('3', '', null, { producerCode: '', producerName: 'Ion' }),
    payment('4', '', null, { producerCode: '', producerName: '' }),
  ])
  assert.equal(result.blockedProducers, 3)
  assert.equal(group(result, 'unassigned').rows, 4)
})
test('empty month has zero totals and legacy review rows remain blocked', () => {
  assert.deepEqual(summarizeBankNote(month, [], []).groups.map(row => row.pendingAmount), [0, 0])
  const result = summarizeBankNote(month, [volume('A', 100)], [payment('1', 'A', null)])
  assert.equal(result.blockedProducers, 1)
  assert.equal(group(result, 'remaining').readyAmount, 0)
})
