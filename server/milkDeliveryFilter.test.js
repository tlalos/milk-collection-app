import assert from 'node:assert/strict'
import test from 'node:test'
import sql from 'mssql'
import { listMilkDeliveries } from './milkDeliveryStore.js'

test('sent-to-Greece query includes both departed statuses and composes with other filters', async (t) => {
  const previous = { user: process.env.SQL_USER, password: process.env.SQL_PASSWORD }
  process.env.SQL_USER = 'test-only'
  process.env.SQL_PASSWORD = 'test-only'
  t.after(() => {
    for (const [key, value] of [['SQL_USER', previous.user], ['SQL_PASSWORD', previous.password]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const calls = []
  t.mock.method(sql.ConnectionPool.prototype, 'connect', async () => ({
    request() {
      const inputs = {}
      return {
        input(name, _type, value) { inputs[name] = value; return this },
        async batch() {},
        async query(text) { calls.push({ inputs, text }); return { recordset: [] } },
      }
    },
  }))
  await listMilkDeliveries()
  assert.equal(calls[0].inputs.sentToGreece, false)
  await listMilkDeliveries({ sentToGreece: true, status: 'COMPLETE', search: 'TRUCK', date: '2026-10-13' })
  assert.equal(calls[1].inputs.sentToGreece, true)
  assert.equal(calls[1].inputs.status, 'COMPLETE')
  assert.equal(calls[1].inputs.search, '%TRUCK%')
  assert.match(calls[1].text, /AND \(@sentToGreece = 0 OR status IN \(N'AWAITING_GREECE', N'COMPLETE'\)\)/)
  assert.match(calls[1].text, /AND \(@status = N'' OR status = @status\)/)
})
