import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

test('CMR SQL migration, structured persistence, rollback and stale-save protection', { skip: process.env.CMR_SQL_TEST !== '1' }, async () => {
  await import('dotenv/config')
  assert.match(process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost', /^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/i)
  const { default: sql } = await import('mssql')
  const { initializeSqlOcrStore, saveSqlJob, getSqlJob, deleteSqlJob, closeSqlOcrStore } = await import('./sqlOcrStore.js')
  const { getMilkReceptionPool, closeMilkReceptionStore } = await import('./milkReceptionStore.js')
  const { initializeCmrSqlStore, normalizedCmrData } = await import('./cmrSqlStore.js')
  const { emptyCmrData } = await import('./cmrDocument.js')
  const id = `cmr-test-${randomUUID()}`
  try {
    await initializeSqlOcrStore()
    const pool = await getMilkReceptionPool()
    const originals = (await pool.request().query('SELECT * FROM dbo.CmrDocuments ORDER BY jobId')).recordset
    assert.equal(await initializeCmrSqlStore(pool), 0)
    assert.deepEqual((await pool.request().query('SELECT * FROM dbo.CmrDocuments ORDER BY jobId')).recordset, originals)
    const now = new Date().toISOString()
    const job = { id, documentCategory: 'cmr', status: 'completed', reviewStatus: 'pending', createdAt: now, updatedAt: now,
      sourceFile: 'cmr-sql-test.png', data: { ...emptyCmrData(), supplier: 'Test supplier', avizNumber: '00001', date: '2026-10-16', quantity: 4400, quantityUnit: 'L', truckNumber: 'TEST' } }
    await saveSqlJob(job)
    assert.deepEqual((await getSqlJob(id)).data, normalizedCmrData(job.data))
    const uncertain = { ...job, data: { ...job.data, quantityUnit: '' }, cmrOcr: { warnings: ['Unit unclear'], uncertainFields: ['quantityUnit'] }, ocrOriginalData: { quantity: 4400, quantityUnit: null } }
    await saveSqlJob(uncertain)
    const loadedUncertain = await getSqlJob(id)
    assert.equal(loadedUncertain.data.quantityUnit, '')
    assert.equal(loadedUncertain.data.kilos, null)
    assert.deepEqual(loadedUncertain.cmrOcr, uncertain.cmrOcr)
    assert.deepEqual(loadedUncertain.ocrOriginalData, uncertain.ocrOriginalData)
    await saveSqlJob(job)
    const raw = (await pool.request().input('id', sql.NVarChar(64), id).query('SELECT jobJson FROM dbo.OcrJobs WHERE id=@id;')).recordset[0]
    assert.equal(JSON.parse(raw.jobJson).data, null)
    const changed = { ...job, updatedAt: new Date(Date.now() + 1000).toISOString(), data: { ...job.data, supplier: 'Updated' } }
    await saveSqlJob(changed, null, { expectedUpdatedAt: now })
    await assert.rejects(saveSqlJob(job, null, { expectedUpdatedAt: now }), error => error.status === 409)
    assert.equal((await getSqlJob(id)).data.supplier, 'Updated')
    await assert.rejects(saveSqlJob({ ...changed, data: { ...changed.data, quantity: -1 } }))
    assert.equal((await getSqlJob(id)).data.quantity, 4400)
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      await saveSqlJob({ ...changed, data: { ...changed.data, supplier: 'Rollback' } }, tx)
    } finally { await tx.rollback() }
    assert.equal((await getSqlJob(id)).data.supplier, 'Updated')
    const receptionId = `cmr-reception-test-${randomUUID()}`
    const seedReception = async transaction => new sql.Request(transaction).input('id', sql.NVarChar(120), receptionId).query(`
      INSERT dbo.MilkReceptions(receptionId,receptionDate,vehicleRegistration,vehicleCategory,routeId,milkType,densityFactor,deliveryCategory,combinationDiagnosis,conformityResult,createdAt,updatedAt)
      VALUES(@id,'20261016',@id,N'OTHER',N'',N'MILK-COW',1.03,N'OTHERS',N'Test',N'Pending',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());`)
    const insertLink = async transaction => new sql.Request(transaction)
      .input('job', sql.NVarChar(64), id).input('reception', sql.NVarChar(120), receptionId).query(`
      INSERT dbo.CmrReceptionLinks(jobId,receptionId,matchedDocumentDate,matchedReceptionDate,matchedTruckNumber,linkedBy)
      VALUES(@job,@reception,'20261016','20261016',N'TEST',N'cmr-sql-test');`)
    const linkStatus = async transaction => (await new sql.Request(transaction).input('job', sql.NVarChar(64), id)
      .query('SELECT status FROM dbo.CmrReceptionLinks WHERE jobId=@job;')).recordset[0]?.status
    const linkTx = new sql.Transaction(pool)
    await linkTx.begin()
    try {
      await seedReception(linkTx); await insertLink(linkTx)
      assert.equal(await linkStatus(linkTx), 'CONFIRMED')
      await new sql.Request(linkTx).input('id', sql.NVarChar(120), receptionId)
        .query("UPDATE dbo.MilkReceptions SET receptionDate='20261017' WHERE receptionId=@id;")
      assert.equal(await linkStatus(linkTx), 'NEEDS_REVIEW')
      await new sql.Request(linkTx).input('id', sql.NVarChar(64), id)
        .query("UPDATE dbo.CmrReceptionLinks SET status=N'CONFIRMED' WHERE jobId=@id;")
      await saveSqlJob({ ...changed, data: { ...changed.data, truckNumber: 'CHANGED' } }, linkTx)
      assert.equal(await linkStatus(linkTx), 'NEEDS_REVIEW')
      await new sql.Request(linkTx).input('id', sql.NVarChar(64), id).query('DELETE dbo.OcrJobs WHERE id=@id;')
      assert.equal(await linkStatus(linkTx), undefined)
    } finally { await linkTx.rollback() }
    for (const failure of ['duplicate', 'collection', 'missing-reception']) {
      const invalidTx = new sql.Transaction(pool)
      await invalidTx.begin()
      try {
        if (failure !== 'missing-reception') await seedReception(invalidTx)
        if (failure === 'duplicate') await insertLink(invalidTx)
        if (failure === 'collection') await new sql.Request(invalidTx).input('id', sql.NVarChar(120), receptionId)
          .query("UPDATE dbo.MilkReceptions SET vehicleCategory=N'COLLECTION' WHERE receptionId=@id;")
        await assert.rejects(insertLink(invalidTx))
      } finally { await invalidTx.rollback().catch(() => undefined) }
    }
    await deleteSqlJob(id)
    assert.equal((await pool.request().input('id', sql.NVarChar(64), id).query('SELECT jobId FROM dbo.CmrDocuments WHERE jobId=@id;')).recordset.length, 0)
  } finally {
    await deleteSqlJob(id).catch(() => undefined)
    await closeSqlOcrStore(); await closeMilkReceptionStore()
  }
})
