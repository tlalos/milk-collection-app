import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('temporary reconciliation identifiers use the restored database collation', async () => {
  const source = await readFile(new URL('./dailyReconciliationLinkStore.js', import.meta.url), 'utf8')
  const table = source.match(/CREATE TABLE #DesiredAvizLinks \(([\s\S]*?)\);/)[1]
  assert.match(table, /jobId NVARCHAR\(64\) COLLATE DATABASE_DEFAULT NOT NULL/)
  assert.match(table, /receptionId NVARCHAR\(120\) COLLATE DATABASE_DEFAULT NOT NULL/)
})
