import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile('index.js', readFileSync(new URL('./index.js', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'monthClosureSummary')
assert.ok(declaration)
const summarize = vm.runInNewContext(`(${declaration.getText(source)})`)

test('pricing summary separates ready quantities from every blocked reason without hiding rows', () => {
 const row = { month: '2026-09', centerKey: 'c1', producerKey: 'p1', readyForPricing: true, liters: 1500 }
 const result = summarize([row,
  { ...row, producerKey: 'old', readyForPricing: false, liters: 1500, approvalReviewRequired: true },
  { ...row, producerKey: 'p2', readyForPricing: false, liters: 935, producerWarning: 'Wrong center' },
  { ...row, producerKey: 'collector', liters: 0 },
  { ...row, producerKey: 'p3', liters: 1.123 },
 ])
 assert.equal(result.totalLiters, 3936.123)
 assert.equal(result.readyLiters, 1501.123)
 assert.equal(result.blockedLiters, 2435)
 assert.equal(result.rowCount, 5)
 assert.equal(result.readyRowCount, 3)
 assert.equal(result.blockedRowCount, 2)
})

test('empty and blocked-only months have zero ready liters', () => {
 for (const rows of [[], [{ month: '2026-09', centerKey: 'c1', producerKey: 'p1', readyForPricing: false, liters: 100 }]]) {
  const result = summarize(rows)
  assert.equal(result.readyLiters, 0)
  assert.equal(result.blockedLiters, result.totalLiters)
 }
})
