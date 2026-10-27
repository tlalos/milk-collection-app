import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

test('closure summary payload uses only selected-month journal membership and Reception factors', async () => {
  const ast = ts.createSourceFile('index.js', readFileSync(new URL('./index.js', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const route = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === 'app.get' && node.expression.arguments[0]?.text === '/api/month-closure/pricing-rows')
  assert.ok(route)
  let handler, payload
  const requestedPermissions = []
  const context = {
    app: { get(_path, ...handlers) { handler = handlers.at(-1) } },
    requirePermission(value) { requestedPermissions.push(value); return () => {} },
    isSqlOcrStoreEnabled: () => true,
    monthlyReconciliationFromJobs: () => {},
    monthlyAvizApprovalContext: async () => ({ jobs: [], approvals: [{ producerCode: 'approval-only' }], reconciliation: { rows: [
      { month: '2026-09', center: 'A', monthlyRows: [{ id: 'j1', producerCode: 'p1', producer: 'Ana' }] },
      { month: '2026-09', center: 'B', monthlyRows: [] },
      { month: '2026-08', center: 'A', monthlyRows: [{ id: 'old', producerCode: 'p2', producer: 'Ion' }] },
    ] } }),
    monthClosurePricingFromJobs: () => ({ selectedMonth: '2026-09', rows: [] }),
    listMonthlyProducerPricingRows: async () => [], previousMonthKey: () => '2026-08',
    getMilkDensitySettings: async () => ({ RECEPTION: [{ code: 'MILK-COW', densityFactor: 1.03 }], DELIVERIES: [{ code: 'MILK-COW', densityFactor: 1.029 }] }),
  }
  vm.runInNewContext(route.getText(ast), context)
  await handler({ query: { month: '2026-09' } }, { json(value) { payload = JSON.parse(JSON.stringify(value)) } }, error => { throw error })
  assert.deepEqual(requestedPermissions, ['month_closure'])
  assert.deepEqual(payload.journalProducers, [{ id: 'j1', center: 'A', producerCode: 'p1', producer: 'Ana' }])
  assert.deepEqual(payload.receptionFactors, [{ code: 'MILK-COW', densityFactor: 1.03 }])
})
