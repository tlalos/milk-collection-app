import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { matchesJobListFilters, validateJobListFilters } from './ocrJobListFilter.js'

test('daily month follows document date, falling back to upload date only without a date', () => {
  const filters = validateJobListFilters({ month: '2026-10', documentCategory: 'daily_routes', reviewStatus: 'pending' })
  const job = { createdAt: '2026-10-28T10:00:00Z', reviewStatus: 'pending', data: { date: '2026-09-30' } }
  assert.equal(matchesJobListFilters(job, filters), false)
  assert.equal(matchesJobListFilters({ ...job, data: { date: '2026-10-01' } }, filters), true)
  assert.equal(matchesJobListFilters({ ...job, data: null }, filters), true)
  assert.equal(matchesJobListFilters({ ...job, data: null, createdAt: '2026-09-30T10:00:00Z' }, filters), false)
  assert.equal(matchesJobListFilters({ ...job, data: null, documentCategory: 'cmr' }, filters), false)
  assert.equal(matchesJobListFilters({ ...job, data: null, reviewStatus: 'reviewed' }, filters), false)
  assert.equal(matchesJobListFilters(job, {}), true)
  assert.equal(matchesJobListFilters({ ...job, status: 'failed' }, { status: 'completed' }), false)
})

test('rejects malformed filters and accepts an explicit all-months request', () => {
  for (const month of ['2026-13', '2026-00', '2026-1', 'invalid', ['2026-10'], '2026-10 OR 1=1']) {
    assert.throws(() => validateJobListFilters({ month }), error => error.status === 400)
  }
  assert.deepEqual(validateJobListFilters({ month: '' }), {})
})

test('SQL applies bound category/status/month constraints before loading job JSON', async () => {
  const source = readFileSync(new URL('./sqlOcrStore.js', import.meta.url), 'utf8')
  const file = ts.createSourceFile('sqlOcrStore.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'listSqlJobs')
  const params = new Map()
  let query
  const request = { input(key, type, value) { params.set(key, value); return this }, async query(value) { query = value; return { recordset: [] } } }
  const context = vm.createContext({ initializeSqlOcrStore: async () => {}, getPool: async () => ({ request: () => request }), sql: { Date: 'date', NVarChar: () => 'text' }, hydrateCmrJob: row => row })
  vm.runInContext(fn.getText(file).replace('export ', ''), context)
  await context.listSqlJobs({ month: '2026-10', documentCategory: 'daily_routes', reviewStatus: 'pending' })
  assert.equal(params.get('monthStart').toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(params.get('documentCategory'), 'daily_routes')
  assert.match(query, /WHERE j.documentCategory = @documentCategory AND j.reviewStatus = @reviewStatus/)
  assert.match(query, /j.dataDate >= @monthStart/)
  assert.match(query, /j.dataDate IS NULL AND CAST\(j.createdAt AS date\)/)
  assert.doesNotMatch(query, /2026-10|daily_routes/)
  await context.listSqlJobs()
  assert.doesNotMatch(query, /WHERE/)
})
