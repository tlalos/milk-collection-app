import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { approvalSourceGuardBatches } from './monthlyAvizPricingApprovalStore.js'

test('SQL source reservations protect new approvals without rewriting legacy conflicts', { skip: process.env.AVIZ_GUARD_SQL_TEST !== '1' }, async () => {
  await import('dotenv/config')
  assert.match(process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost', /^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/i)
  const { default: sql } = await import('mssql')
  const { getMilkReceptionPool, closeMilkReceptionStore } = await import('./milkReceptionStore.js')
  const local = await getMilkReceptionPool()
  const database = `MilkApprovalGuardTest_${randomUUID().replaceAll('-', '')}`
  assert.match(database, /^MilkApprovalGuardTest_[a-f0-9]{32}$/)
  let isolated, created = false
  try {
    await local.request().batch(`CREATE DATABASE [${database}]`)
    created = true
    await local.request().batch(`ALTER DATABASE [${database}] SET READ_COMMITTED_SNAPSHOT ON`)
    isolated = await new sql.ConnectionPool({ ...local.config, database }).connect()
    await isolated.request().batch(`
      CREATE TABLE dbo.MonthlyAvizPricingApprovals (approvalId UNIQUEIDENTIFIER PRIMARY KEY, status NVARCHAR(20) NOT NULL);
      CREATE TABLE dbo.MonthlyAvizPricingApprovalLines (
        approvalLineId BIGINT IDENTITY PRIMARY KEY, approvalId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.MonthlyAvizPricingApprovals(approvalId),
        jobId NVARCHAR(64) NOT NULL, rowNumber INT NOT NULL, approvedLiters DECIMAL(18,3) NOT NULL DEFAULT 100,
        UNIQUE(approvalId,jobId,rowNumber));`)
    const header = async (status = 'APPROVED') => {
      const id = randomUUID()
      await isolated.request().input('id', sql.UniqueIdentifier, id).input('status', sql.NVarChar(20), status)
        .query('INSERT dbo.MonthlyAvizPricingApprovals VALUES (@id,@status)')
      return id
    }
    const line = (id, job = 'legacy', row = 1) => isolated.request().input('id', sql.UniqueIdentifier, id)
      .input('job', sql.NVarChar(64), job).input('row', sql.Int, row)
      .query('INSERT dbo.MonthlyAvizPricingApprovalLines(approvalId,jobId,rowNumber) VALUES (@id,@job,@row)')
    const status = (id, value) => isolated.request().input('id', sql.UniqueIdentifier, id).input('status', sql.NVarChar(20), value)
      .query('UPDATE dbo.MonthlyAvizPricingApprovals SET status=@status WHERE approvalId=@id')
    const snapshot = async () => (await isolated.request().query('SELECT * FROM dbo.MonthlyAvizPricingApprovals ORDER BY approvalId; SELECT * FROM dbo.MonthlyAvizPricingApprovalLines ORDER BY approvalLineId')).recordsets
    const old = await header('NEEDS_REVIEW'), current = await header()
    await line(old); await line(current)
    const before = JSON.stringify(await snapshot())
    for (let i = 0; i < 2; i++) for (const batch of approvalSourceGuardBatches) await isolated.request().batch(batch)
    assert.equal(JSON.stringify(await snapshot()), before, 'idempotent migration must preserve legacy records')

    const next = await header()
    const reserved = error => error.number === 51001 && /reserved/.test(error.message)
    await assert.rejects(line(next), reserved)
    await status(current, 'CANCELLED')
    await assert.rejects(line(next), reserved, 'needs-review approval still reserves the line')
    await status(old, 'CANCELLED')
    await line(next)
    await assert.rejects(status(current, 'APPROVED'), reserved, 'reactivation cannot bypass reservation')
    await status(next, 'NEEDS_REVIEW')
    await assert.rejects(line(await header()), reserved)
    await line(next, 'legacy', 2)
    await line(next, 'different', 1)

    const cancelled = await header('CANCELLED')
    await line(cancelled)
    await assert.rejects(status(cancelled, 'NEEDS_REVIEW'), reserved)
    const edit = await header()
    await line(edit, 'editable')
    await assert.rejects(isolated.request().input('id', sql.UniqueIdentifier, edit)
      .query("UPDATE dbo.MonthlyAvizPricingApprovalLines SET jobId='legacy' WHERE approvalId=@id"), reserved)

    const bulkA = await header(), bulkB = await header()
    await assert.rejects(isolated.request().input('a', sql.UniqueIdentifier, bulkA).input('b', sql.UniqueIdentifier, bulkB)
      .query("INSERT dbo.MonthlyAvizPricingApprovalLines(approvalId,jobId,rowNumber) VALUES (@a,'bulk',1),(@b,'bulk',1)"), reserved)

    const raceA = await header(), raceB = await header()
    const race = await Promise.allSettled([line(raceA, 'concurrent'), line(raceB, 'concurrent')])
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1)
    assert.ok(race.some(result => result.status === 'rejected' && [51001, 1205].includes(result.reason.number)))
    const count = await isolated.request().query("SELECT COUNT(*) AS n FROM dbo.MonthlyAvizPricingApprovalLines WHERE jobId='concurrent'")
    assert.equal(count.recordset[0].n, 1)
  } finally {
    await isolated?.close()
    // Only the uniquely named database created by this test is removed.
    if (created) await local.request().batch(`DROP DATABASE [${database}]`)
    await closeMilkReceptionStore()
  }
})
