import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { kgOnlyDeliveryMigrationSql } from './milkDeliveryStore.js'

test('kg-only migration preserves weights and milk rows, clears liters once, and blocks stale SQL writes', { skip: process.env.DELIVERY_QUANTITY_SQL_TEST !== '1' }, async () => {
  await import('dotenv/config')
  assert.match(process.env.SQL_SERVER || 'localhost', /^(localhost|127\.0\.0\.1|\.)(\\[^\\]+)?$/i)
  const { default: sql } = await import('mssql')
  const { getMilkReceptionPool, closeMilkReceptionStore } = await import('./milkReceptionStore.js')
  const local = await getMilkReceptionPool()
  const database = `DeliveryQuantityTest_${randomUUID().replaceAll('-', '')}`
  assert.match(database, /^DeliveryQuantityTest_[a-f0-9]{32}$/)
  let isolated, created = false
  try {
    await local.request().batch(`CREATE DATABASE [${database}]`)
    created = true
    isolated = await new sql.ConnectionPool({ ...local.config, database }).connect()
    await isolated.request().batch(`CREATE TABLE dbo.MilkDeliveries (
      deliveryId int PRIMARY KEY, milkType nvarchar(60), calculatedLiters decimal(18,3),
      loadedWeightKg decimal(18,3), emptyWeightKg decimal(18,3), netQuantityKg decimal(18,3),
      greeceWeight decimal(18,3), differenceAmount decimal(18,3), updatedBy nvarchar(160));
      INSERT dbo.MilkDeliveries VALUES
      (1,'WHEY',1000,2000,1000,1000,990,-10,'original'),
      (2,'LACTOSE',1000,2000,1000,1000,990,-10,'original'),
      (3,'MILK-COW',971.817,2000,1000,1000,990,-10,'original');`)
    const read = async () => (await isolated.request().query('SELECT * FROM dbo.MilkDeliveries ORDER BY deliveryId')).recordset
    const before = await read()
    await isolated.request().batch(kgOnlyDeliveryMigrationSql)
    const after = await read()
    assert.deepEqual(after, before.map(row => row.milkType === 'MILK-COW' ? row : { ...row, calculatedLiters: null }))
    await isolated.request().batch(kgOnlyDeliveryMigrationSql)
    assert.deepEqual(await read(), after)
    await assert.rejects(isolated.request().query('UPDATE dbo.MilkDeliveries SET calculatedLiters=1000 WHERE deliveryId=1'), /CK_MilkDeliveries_KgOnly/)
    await assert.rejects(isolated.request().query("UPDATE dbo.MilkDeliveries SET milkType='LACTOSE' WHERE deliveryId=3"), /CK_MilkDeliveries_KgOnly/)
    const total = await isolated.request().query('SELECT SUM(calculatedLiters) AS liters FROM dbo.MilkDeliveries')
    assert.equal(total.recordset[0].liters, 971.817)
  } finally {
    await isolated?.close()
    if (created) await local.request().batch(`DROP DATABASE [${database}]`)
    await closeMilkReceptionStore()
  }
})
