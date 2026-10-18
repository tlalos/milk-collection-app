import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

test('CMR matching persists, checks stale state, rejects nonmatching receptions and audits without changing weights', { skip: process.env.CMR_SQL_TEST !== '1' }, async () => {
  await import('dotenv/config')
  assert.match(process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost', /^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/i)
  const { default: sql } = await import('mssql')
  const { initializeSqlOcrStore, saveSqlJob, deleteSqlJob, closeSqlOcrStore, getCmrReceptionMatch, saveCmrReceptionMatch, listCmrReconciliationLinks } = await import('./sqlOcrStore.js')
  const { getMilkReceptionPool, closeMilkReceptionStore } = await import('./milkReceptionStore.js')
  const { emptyCmrData } = await import('./cmrDocument.js')
  const id = `cmr-match-test-${randomUUID()}`
  const now = new Date().toISOString()
  let pool
  try {
    await initializeSqlOcrStore(); pool = await getMilkReceptionPool()
    const job = { id, documentCategory: 'cmr', status: 'completed', reviewStatus: 'reviewed', createdAt: now, updatedAt: now,
      sourceFile: 'test.png', data: { ...emptyCmrData(), date: '2026-10-17', truckNumber: id, quantity: 1600 } }
    await saveSqlJob(job)
    for (const [suffix, category, date, truck] of [['other', 'OTHER', '2026-10-17', id], ['collection', 'COLLECTION', '2026-10-17', id], ['date', 'OTHER', '2026-10-16', id], ['truck', 'OTHER', '2026-10-17', id + 'X']]) {
      await pool.request().input('id', sql.NVarChar(120), `${id}-${suffix}`).input('truck', sql.NVarChar(80), truck)
        .input('category', sql.NVarChar(40), category).input('date', sql.Date, date)
        .query(`INSERT dbo.MilkReceptions(receptionId,receptionDate,vehicleRegistration,vehicleCategory,routeId,milkType,densityFactor,
          netQuantityKg,calculatedLiters,deliveryCategory,combinationDiagnosis,conformityResult,createdAt,updatedAt)
          VALUES(@id,@date,@truck,@category,N'',N'MILK-COW',1.03,1600,1553.398,N'OTHERS',N'Test',N'Pending',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());`)
    }
    const originals = (await pool.request().input('prefix', sql.NVarChar(120), `${id}-%`).query('SELECT * FROM dbo.MilkReceptions WHERE receptionId LIKE @prefix ORDER BY receptionId;')).recordset
    const state = await getCmrReceptionMatch(id)
    assert.equal(state.link, null)
    assert.deepEqual(state.candidates.map(row => row.receptionId), [`${id}-other`])
    const input = { receptionId: state.candidates[0].receptionId, receptionUpdatedAt: state.candidates[0].updatedAt,
      documentVersion: state.documentVersion, updatedAt: now, linkVersion: null }
    const user = { username: 'cmr-match-test' }
    for (const suffix of ['collection', 'date', 'truck', 'missing']) {
      await assert.rejects(saveCmrReceptionMatch(id, { ...input, receptionId: `${id}-${suffix}` }, user), err => err.status === 409)
    }
    await assert.rejects(saveCmrReceptionMatch(id, { ...input, receptionUpdatedAt: '2000-01-01T00:00:00.000Z' }, user), err => err.status === 409)
    await assert.rejects(saveCmrReceptionMatch(id, { ...input, documentVersion: '0x0000000000000000' }, user), err => err.status === 409)
    await assert.rejects(saveCmrReceptionMatch(id, { ...input, updatedAt: 'stale' }, user), err => err.status === 409)
    await assert.rejects(saveCmrReceptionMatch(id, { receptionId: input.receptionId }, user), err => err.status === 400)
    const linked = await saveCmrReceptionMatch(id, input, user)
    assert.equal(linked.link.status, 'CONFIRMED')
    assert.deepEqual((await listCmrReconciliationLinks()).find(row => row.jobId === id), { jobId: id, receptionId: input.receptionId, status: 'CONFIRMED' })
    assert.equal(linked.linkedReception.netQuantityKg, 1600)
    assert.equal((await getCmrReceptionMatch(id)).link.receptionId, input.receptionId)
    await assert.rejects(saveCmrReceptionMatch(id, input, user), err => err.status === 409)
    assert.deepEqual((await pool.request().input('prefix', sql.NVarChar(120), `${id}-%`).query('SELECT * FROM dbo.MilkReceptions WHERE receptionId LIKE @prefix ORDER BY receptionId;')).recordset, originals)
    // A document edit invalidates the old matching screen and marks the existing link for review.
    await saveSqlJob({ ...job, updatedAt: new Date(Date.now() + 1000).toISOString(), data: { ...job.data, date: '2026-10-18' } })
    const review = await getCmrReceptionMatch(id)
    assert.equal(review.link.status, 'NEEDS_REVIEW')
    assert.equal(review.candidates.length, 0)
    assert.notEqual(review.documentVersion, state.documentVersion)
    await assert.rejects(saveCmrReceptionMatch(id, { ...input, linkVersion: linked.link.version }, user), err => err.status === 409)
    await saveSqlJob({ ...job, updatedAt: new Date(Date.now() + 2000).toISOString() })
    const restored = await getCmrReceptionMatch(id)
    await saveCmrReceptionMatch(id, { ...input, documentVersion: restored.documentVersion, updatedAt: restored.updatedAt, linkVersion: restored.link.version }, user)
    await pool.request().input('id', sql.NVarChar(120), input.receptionId)
      .query("UPDATE dbo.MilkReceptions SET vehicleCategory=N'COLLECTION',routeId=N'cmr-match-test' WHERE receptionId=@id;")
    const recategorized = await getCmrReceptionMatch(id)
    assert.equal(recategorized.link.status, 'NEEDS_REVIEW')
    assert.equal(recategorized.candidates.length, 0)
    await assert.rejects(saveCmrReceptionMatch(id, { ...input, documentVersion: recategorized.documentVersion, updatedAt: recategorized.updatedAt, linkVersion: recategorized.link.version }, user), err => err.status === 409)
    const unlinked = await saveCmrReceptionMatch(id, { ...input, receptionId: null, documentVersion: recategorized.documentVersion, updatedAt: recategorized.updatedAt, linkVersion: recategorized.link.version }, user)
    assert.equal(unlinked.link, null)
    const audit = (await pool.request().input('id', sql.NVarChar(240), id).query("SELECT * FROM dbo.AppAuditLog WHERE entityId=@id AND action=N'cmr.reception.link';")).recordset
    assert.equal(audit.length, 3)
    await assert.rejects(getCmrReceptionMatch('not-a-cmr'), err => err.status === 404)
  } finally {
    await deleteSqlJob(id).catch(() => undefined)
    if (pool) {
      await pool.request().input('prefix', sql.NVarChar(120), `${id}-%`).query('DELETE dbo.MilkReceptions WHERE receptionId LIKE @prefix;')
      await pool.request().input('id', sql.NVarChar(240), id).query('DELETE dbo.AppAuditLog WHERE entityId=@id;')
    }
    await closeSqlOcrStore(); await closeMilkReceptionStore()
  }
})
