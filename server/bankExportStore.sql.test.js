import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import sql from 'mssql'
import { createBankExportStore } from './bankExportStore.js'

test('bank export SQL transactions, snapshots, duplicate protection, retry, cancellation and file retention', { skip:process.env.BANK_EXPORT_SQL_TEST !== '1' }, async () => {
  await import('dotenv/config')
  const server = process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost'
  assert.match(server,/^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/i)
  const database = `BankExportTest_${randomUUID().replaceAll('-','')}`
  const config = { server, port:Number(process.env.SQL_PORT || process.env.MSSQL_PORT) || undefined, database:'master',
    user:process.env.SQL_USER || process.env.MSSQL_USER, password:process.env.SQL_PASSWORD || process.env.MSSQL_PASSWORD,
    options:{ encrypt:false,trustServerCertificate:true }, pool:{max:10} }
  const master=await new sql.ConnectionPool(config).connect()
  let pool
  try {
    await master.request().query(`CREATE DATABASE [${database}]`)
    pool=await new sql.ConnectionPool({...config,database}).connect()
    const store=createBankExportStore(async()=>pool)
    const user={username:'bank-history-test',isAdmin:true}
    const row=id=>({id,producerCode:id,producerName:`Producer ${id}`,centers:['Snapshot center'],recipientCode:id,recipientName:'Recipient',iban:'RO123',amount:12.34,totalLiters:10,milkType:'COW',comment:'Lapte septembrie 2026'})
    const request=ids=>({month:'2026-09',requestKey:randomUUID(),rows:ids.map(row)})
    const build=async input=>structuredClone(input.rows)
    const firstInput=request(['p1','p2'])
    const first=await store.create(firstInput,user,build)
    assert.equal(first.exportNumber,1); assert.equal(first.paymentCount,2);assert.equal(first.totalAmount,24.68)
    const savedFile=await store.get(first.batchId,true)
    assert.equal(createHash('sha256').update(savedFile.fileData).digest('hex'),savedFile.sha256)
    assert.deepEqual(first.lines[0].centers,['Snapshot center'])
    const retry=await store.create(firstInput,user,()=>{throw new Error('Must not re-read changed sources')})
    assert.equal(retry.batchId,first.batchId)
    const changed=structuredClone(firstInput);changed.rows[0].amount=20
    await assert.rejects(store.create(changed,user,build),/different contents/)
    await assert.rejects(store.create(request(['p2']),user,build),/already belong/)
    const failed=request(['p3'])
    await assert.rejects(store.create(failed,user,()=>{throw new Error('Source read failed')}),/Source read failed/)
    assert.equal((await store.list('2026-09')).batches.length,1)
    // Force a failure after the file has been inserted and verify rollback of the entire batch.
    await pool.request().query("CREATE TRIGGER RejectTestLine ON dbo.BankExportLines AFTER INSERT AS BEGIN THROW 50001,'Simulated line insert failure',1; END")
    await assert.rejects(store.create(failed,user,build),/Simulated line insert failure/)
    assert.equal((await store.list('2026-09')).batches.length,1)
    await pool.request().query('DROP TRIGGER RejectTestLine')
    const second=await store.create(failed,user,build);assert.equal(second.exportNumber,2)
    // Concurrent exports of the same payment must produce one success, one conflict.
    const attempts=await Promise.allSettled([store.create(request(['p4']),user,build),store.create(request(['p4']),user,build)])
    assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1)
    assert.equal(attempts.filter(result=>result.status==='rejected').length,1)
    await assert.rejects(store.cancel(first.batchId,'Duplicate',{username:'ordinary',isAdmin:false}),/administrator/)
    await assert.rejects(store.cancel(first.batchId,'',user),/reason/)
    await store.cancel(first.batchId,'Not sent to bank',user)
    await store.cancel(first.batchId,'Do not overwrite original reason',user)
    const cancelled=await store.get(first.batchId)
    assert.equal(cancelled.cancelReason,'Not sent to bank');assert.equal(cancelled.lines.length,2)
    assert.deepEqual((await store.get(first.batchId,true)).fileData,savedFile.fileData)
    assert.equal((await store.list('2026-09')).payments.some(payment=>payment.id==='p1'),false)
    const reexport=await store.create(request(['p1']),user,build)
    assert.equal(reexport.exportNumber,4)
    assert.equal((await store.list('2026-09')).batches.length,4)
    assert.equal((await store.list('2026-10')).batches.length,0)
  } finally {
    await pool?.close()
    // Only this test's uniquely named temporary database can be removed.
    assert.match(database,/^BankExportTest_[0-9a-f]{32}$/)
    await master.request().query(`IF DB_ID('${database}') IS NOT NULL DROP DATABASE [${database}]`)
    await master.close()
  }
})
