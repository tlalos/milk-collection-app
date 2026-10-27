import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const built = await build({ entryPoints: ['src/monthClosureCenterSummary.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { summarizeClosureCenters: calculate } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const factors = [{ code: 'MILK-COW', densityFactor: 1.03 }, { code: 'MILK-SHEEP', densityFactor: 1.036 }]
const summarizeClosureCenters = (month, rows) => calculate(month, rows, rows.filter(row => row.month === month), factors)
const month = '2026-09'
const row = (id, center, producerCode, liters, readyForPricing = true) => ({ id, month, center, producerCode, producer: producerCode, milkType: 'MILK-COW', liters, readyForPricing })

test('combines centers and quantities across pages and counts each producer once per center', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(String(i), i % 2 ? ' Center A ' : 'center a', `p${i}`, 100))
  rows.push({ ...row('another-milk', 'Center A', ' P1 ', 50), producer: 'Renamed producer' })
  rows.push({ ...row('different-month', 'Center A', 'p31', 9999), month: '2026-08' })
  const result = summarizeClosureCenters(month, rows)
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].producerCount, 30)
  assert.equal(result.totalLiters, 3050)
  assert.equal(result.producerCount, 30)
})

test('blocked quantities stay separate and global producer count is distinct across centers', () => {
  const result = summarizeClosureCenters(month, [row('1', 'A', 'p1', 100), row('2', 'B', 'p1', 1500, false), row('3', 'B', 'p2', 0)])
  assert.equal(result.producerCount, 2)
  assert.equal(result.groups[1].producerCount, 2)
  assert.equal(result.readyLiters, 100)
  assert.equal(result.blockedLiters, 1500)
  assert.equal(result.totalLiters, 1600)
})

test('missing codes fall back to names, unassigned centers remain visible, and decimals stay precise', () => {
  const result = summarizeClosureCenters(month, [
    { ...row('1', '', '', 0.1), producer: 'Ana' },
    { ...row('2', '', '', 0.2), producer: ' ANA ' },
    { ...row('3', '', '', NaN), producer: 'Ion' },
  ])
  assert.equal(result.groups[0].center, 'Unassigned center')
  assert.equal(result.producerCount, 2)
  assert.equal(result.totalLiters, 0.3)
})

test('filtered and empty summaries only include supplied monthly rows', () => {
  const rows = [row('1', 'A', 'p1', 100), row('2', 'B', 'p2', 50, false)]
  assert.equal(summarizeClosureCenters(month, rows.filter(r => !r.readyForPricing)).totalLiters, 50)
  assert.deepEqual(summarizeClosureCenters(month, []), { groups: [], producerCount: 0, readyLiters: 0, blockedLiters: 0, totalLiters: 0, estimatedKg: 0 })
})

test('producer counts come only from monthly journals, including zero-volume journal producers', () => {
  const journal = [row('j1', 'A', 'p1', 100), row('j2', 'A', 'p1', 20), row('j3', 'A', 'p2', 0)]
  const pricing = [journal[0], row('approval', 'A', 'p3', 300), row('collector', 'A', 'p4', 0), row('only-aviz', 'B', 'p5', 100)]
  const result = calculate(month, pricing, journal, factors)
  assert.equal(result.groups[0].producerCount, 2)
  assert.equal(result.groups[1].producerCount, 0)
  assert.equal(result.producerCount, 2)
  assert.equal(result.totalLiters, 500)
  assert.equal(calculate(month, [pricing[0]], journal, factors).producerCount, 2, 'quantity filters do not change full-month journal membership')
})

test('estimates kilograms per milk type and refuses partial estimates when a factor is missing', () => {
  const rows = [row('cow', 'A', 'p1', 100), { ...row('sheep', 'A', 'p2', 200), milkType: 'MILK-SHEEP' }]
  assert.equal(calculate(month, rows, rows, factors).estimatedKg, 310.2)
  assert.equal(calculate(month, rows, rows, factors.slice(0, 1)).estimatedKg, null)
  assert.equal(calculate(month, rows, rows, [{ code: 'MILK-COW', densityFactor: 0 }]).groups[0].estimatedKg, null)
  assert.equal(calculate(month, [row('collector', 'A', 'p4', 0)], [], []).estimatedKg, 0)
})
