import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { parseHistoryDateRange } from './historyDateRange.js'
import { parseReceptionHistoryDate, receptionHistoryDateSql } from './receptionHistoryFilter.js'

test('history dates accept optional canonical instants and reject invalid ranges', () => {
  assert.deepEqual(parseHistoryDateRange({}), { from: null, until: null })
  const from = '2026-10-13T21:00:00.000Z', until = '2026-10-14T21:00:00.000Z'
  assert.equal(parseHistoryDateRange({ from }).from.toISOString(), from)
  assert.equal(parseHistoryDateRange({ until }).until.toISOString(), until)
  assert.equal(parseHistoryDateRange({ from, until }).error, undefined)
  for (const query of [{ from: 'bad' }, { from: ['2026-10-14'] }, { from: '2026-02-30T00:00:00.000Z' }, { from: until, until: from }, { from, until: from }]) {
    assert.ok(parseHistoryDateRange(query).error)
  }
})

const configurations = [
  ['appSecurityStore.js', 'listAuditActivity', 'occurredAt', 'auditId', 'presentAuditActivity', 'initializeAuthStore'],
  ['milkReceptionStore.js', 'listMilkReceptionWeightHistoryForAdmin', 'recordedAt', 'eventId', 'weightEventToClient', 'initializeMilkReceptionStore'],
  ['milkDeliveryStore.js', 'listMilkDeliveryWeightHistoryForAdmin', 'recordedAt', 'eventId', 'weightEventToClient', 'initializeMilkDeliveryStore'],
]
for (const [file, name, timestamp, id, presenter, initialize] of configurations) {
  test(`${name} binds dates in SQL alongside cursor before limiting results`, async () => {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name.text === name).getText(ast).replace(/^export /, '')
    const parameters = {}, queries = []
    const request = { input(key, type, value) { parameters[key] = value; return this }, async query(sql) {
      queries.push(sql)
      return { recordset: Array.from({ length: 51 }, (_, index) => ({ [id]: String(100 - index) })) }
    } }
    const context = { sql: { NVarChar: () => 'text', BigInt: 'bigint', DateTimeOffset: 'datetimeoffset' },
      getPool: async () => ({ request: () => request }), [initialize]: async () => {}, [presenter]: row => row, receptionHistoryDateSql }
    vm.createContext(context)
    vm.runInContext(fn, context)
    const range = parseHistoryDateRange({ from: '2026-10-13T21:00:00.000Z', until: '2026-10-14T21:00:00.000Z' })
    const result = await context[name]({ ...range, beforeId: '101', username: 'test' })
    assert.equal(parameters.from, range.from)
    assert.equal(parameters.until, range.until)
    assert.equal(parameters.beforeId, '101')
    assert.ok(queries[0].includes(`${timestamp} >= @from`))
    assert.ok(queries[0].includes(`${timestamp} < @until`))
    assert.ok(queries[0].indexOf(`${timestamp} < @until`) < queries[0].indexOf('ORDER BY'))
    if (name !== 'listMilkDeliveryWeightHistoryForAdmin') {
      await context[name]({ ...range, receptionDate: '2026-08-10', beforeId: '51' })
      assert.equal(parameters.receptionDate, '2026-08-10')
      assert.ok(queries[1].includes('r.receptionDate = CONVERT(date, @receptionDate, 23)'))
      assert.ok(queries[1].includes('history.beforeJson'))
      assert.ok(queries[1].includes('history.afterJson'))
      assert.ok(queries[1].indexOf('$.receptionDate') < queries[1].indexOf('ORDER BY'))
    }
    assert.equal(result.entries.length, 50)
    assert.equal(result.nextBeforeId, '51')
    await context[name]()
    assert.equal(parameters.from, null)
    assert.equal(parameters.until, null)
  })
}

test('all three history endpoints validate and forward dates with pagination', async () => {
  const source = await readFile(new URL('index.js', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('index.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  for (const path of ['/api/web-users/activity', '/api/web-users/weight-history', '/api/web-users/delivery-weight-history']) {
    let handler, input
    const route = ast.statements.find(s => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && s.expression.arguments[0]?.text === path)
    const context = { app: { get: (_path, _guard, callback) => { handler = callback } },
      requirePermission: permission => { assert.equal(permission, 'audit_log') }, parseHistoryDateRange, parseReceptionHistoryDate }
    for (const [, name] of configurations) context[name] = async value => { input = value; return { entries: [] } }
    vm.runInNewContext(route.getText(ast), context)
    const res = { status(code) { this.code = code; return this }, json(body) { this.body = body } }
    await handler({ query: { from: 'invalid' } }, res, error => { throw error })
    assert.equal(res.code, 400)
    assert.equal(input, undefined)
    await handler({ query: { from: '2026-10-13T21:00:00.000Z', until: '2026-10-14T21:00:00.000Z', beforeId: '100' } }, res, error => { throw error })
    assert.equal(input.from.toISOString(), '2026-10-13T21:00:00.000Z')
    assert.equal(input.until.toISOString(), '2026-10-14T21:00:00.000Z')
    assert.equal(String(input.beforeId), '100')
    if (path !== '/api/web-users/delivery-weight-history') {
      await handler({ query: { receptionDate: '2026-08-10', beforeId: '51' } }, res, error => { throw error })
      assert.equal(input.receptionDate, '2026-08-10')
      assert.equal(String(input.beforeId), '51')
      input = undefined
      await handler({ query: { receptionDate: '2026-02-30' } }, res, error => { throw error })
      assert.equal(res.code, 400)
      assert.equal(input, undefined)
    }
  }
})

test('reception day is a strict date-only filter independent of change timestamps', () => {
  assert.deepEqual(parseReceptionHistoryDate(''), { receptionDate: null })
  assert.deepEqual(parseReceptionHistoryDate('2026-08-10'), { receptionDate: '2026-08-10' })
  assert.deepEqual(parseReceptionHistoryDate('2024-02-29'), { receptionDate: '2024-02-29' })
  for (const input of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-08-10T00:00:00Z', ['2026-08-10']]) {
    assert.ok(parseReceptionHistoryDate(input).error)
  }
})
