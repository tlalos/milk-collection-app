import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

async function refreshFunction() {
  const source = await readFile(new URL('./dailyReconciliationLinkStore.js', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('store.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  return ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'refreshChunk').getText(ast)
}

function sessionHarness(source, { staleTable = false, failUpdate = false } = {}) {
  const state = { tempTable: staleTable, commits: 0, rollbacks: 0, failUpdate, commands: [] }
  class Transaction {
    async begin() { this.before = state.tempTable }
    async commit() { state.commits++ }
    async rollback() { state.tempTable = this.before; state.rollbacks++ }
  }
  class Request {
    input() { return this }
    async batch(text) {
      state.commands.push(text)
      if (text.includes("OBJECT_ID(N'tempdb..#DesiredAvizLinks'")) state.tempTable = false
      if (text.includes('CREATE TABLE #DesiredAvizLinks')) {
        if (state.tempTable) throw new Error("There is already an object named '#DesiredAvizLinks'")
        state.tempTable = true
      } else if (text.includes('DROP TABLE #DesiredAvizLinks')) state.tempTable = false
    }
    async query(text) {
      state.commands.push(text)
      if (text.includes('#DesiredAvizLinks')) assert.equal(state.tempTable, true)
      if (text.includes('UPDATE link SET') && state.failUpdate) throw new Error('Simulated update failure')
      return { recordset: [] }
    }
  }
  const refresh = vm.runInNewContext(`(${source})`, {
    sql: { Transaction, Request, NVarChar: () => 'text', Int: 'int', Date: 'date' },
    dateParameters: () => '@date0',
    desiredDailyAvizLinks: () => [{ jobId: 'test', rowIndex: 0, rowNumber: 1, receptionId: 'r1', documentDate: '2026-10-31' }],
  })
  return { state, run: () => refresh({}, [], ['2026-10-31']) }
}

test('temporary reconciliation identifiers use the restored database collation', async () => {
  const source = await readFile(new URL('./dailyReconciliationLinkStore.js', import.meta.url), 'utf8')
  const table = source.match(/CREATE TABLE #DesiredAvizLinks \(([\s\S]*?)\);/)[1]
  assert.match(table, /jobId NVARCHAR\(64\) COLLATE DATABASE_DEFAULT NOT NULL/)
  assert.match(table, /receptionId NVARCHAR\(120\) COLLATE DATABASE_DEFAULT NOT NULL/)
})

test('repeated reconciliation chunks release their temporary table before committing', async () => {
  const { state, run } = sessionHarness(await refreshFunction())
  for (let index = 0; index < 3; index++) {
    assert.equal(await run(), 1)
    assert.equal(state.tempTable, false)
  }
  assert.equal(state.commits, 3)
  assert.equal(state.rollbacks, 0)
})

test('a stale pooled-session temp table is replaced without blocking reconciliation', async () => {
  const { state, run } = sessionHarness(await refreshFunction(), { staleTable: true })
  assert.equal(await run(), 1)
  assert.equal(state.tempTable, false)
})

test('failed reconciliation rolls back and a later retry recovers even with a stale table', async () => {
  const { state, run } = sessionHarness(await refreshFunction(), { staleTable: true, failUpdate: true })
  await assert.rejects(run(), /Simulated update failure/)
  assert.equal(state.commits, 0)
  assert.equal(state.rollbacks, 1)
  state.failUpdate = false
  assert.equal(await run(), 1)
  assert.equal(state.tempTable, false)
})

test('regression harness reproduces the original duplicate-temp-table failure', async () => {
  const legacy = (await refreshFunction())
    .replace(/IF OBJECT_ID\(N'tempdb\.\.#DesiredAvizLinks', N'U'\) IS NOT NULL\s+DROP TABLE #DesiredAvizLinks;/u, '')
    .replace("await new sql.Request(transaction).batch('DROP TABLE #DesiredAvizLinks;')", '')
  const { run } = sessionHarness(legacy)
  await run()
  await assert.rejects(run(), /already an object named/)
})

test('SQL pooled-session regression and cleanup use only a local temporary table', { skip: process.env.AVIZ_TEMP_SQL_TEST !== '1' }, async () => {
  await import('dotenv/config')
  const server = process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost'
  assert.match(server, /^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/iu)
  const { default: sql } = await import('mssql')
  const port = Number(process.env.SQL_PORT || process.env.MSSQL_PORT || '')
  const pool = await new sql.ConnectionPool({
    server, ...(port ? { port } : {}), database: 'tempdb',
    user: process.env.SQL_USER || process.env.MSSQL_USER,
    password: process.env.SQL_PASSWORD || process.env.MSSQL_PASSWORD,
    options: {
      encrypt: (process.env.SQL_ENCRYPT || process.env.MSSQL_ENCRYPT || 'false') === 'true',
      trustServerCertificate: (process.env.SQL_TRUST_SERVER_CERTIFICATE || process.env.MSSQL_TRUST_SERVER_CERTIFICATE || 'true') === 'true',
    },
    pool: { max: 1, min: 1, idleTimeoutMillis: 30000 },
  }).connect()
  const source = await refreshFunction()
  const create = source.match(/\.batch\(`([\s\S]*?CREATE TABLE #DesiredAvizLinks[\s\S]*?)`\)/u)[1]
  const drop = source.match(/\.batch\('(DROP TABLE #DesiredAvizLinks;)'\)/u)[1]
  const legacyCreate = create.replace(/IF OBJECT_ID\(N'tempdb\.\.#DesiredAvizLinks', N'U'\) IS NOT NULL\s+DROP TABLE #DesiredAvizLinks;/u, '')
  async function run(createSql, cleanup) {
    const transaction = new sql.Transaction(pool)
    await transaction.begin()
    try {
      await new sql.Request(transaction).batch(createSql)
      if (cleanup) await new sql.Request(transaction).batch(drop)
      await transaction.commit()
    } catch (error) {
      await transaction.rollback().catch(() => undefined)
      throw error
    }
  }
  try {
    // Force reuse of one SQL session, as happens between reconciliation chunks.
    await run(legacyCreate, false)
    await assert.rejects(run(legacyCreate, false), error => error.number === 2714)
    for (let index = 0; index < 3; index++) {
      await run(create, true)
      const result = await pool.request().query("SELECT OBJECT_ID(N'tempdb..#DesiredAvizLinks', N'U') AS tableId;")
      assert.equal(result.recordset[0].tableId, null)
    }
  } finally {
    await pool.close()
  }
})
