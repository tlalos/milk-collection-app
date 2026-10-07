import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const built = await build({ entryPoints: ['src/veterinaryExport.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { buildVeterinaryProducerList, veterinaryAnimalGroups, hasMissingVeterinaryCounts } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const row = (id, producerCode, liters = 10, producer = 'Producer') => ({ id, producerCode, producer, liters })
const group = (milkType, monthlyRows, month = '2026-08') => ({ milkType, monthlyRows, month })

test('both forms use selected-month positive deliveries and saved ERP county and tax ID', () => {
  const rows = buildVeterinaryProducerList([
    group('MILK-COW', [row('1', ' p001 '), row('2', 'p002', 0), row('3', 'p003', null)]),
    group('MILK-COW', [row('4', 'p004')], '2026-07'),
  ], '2026-08', [], [{ producerCode: 'P001', county: ' CLUJ ', trn: '001234' }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].county, 'CLUJ')
  assert.equal(rows[0].taxId, '001234')
  assert.deepEqual(rows[0].animalGroups, ['cow'])
  assert.deepEqual(rows[0].liters, { cow: 10, buffalo: 0, sheepGoat: 0 })
  assert.equal(rows[0].cowCount, undefined)
  assert.deepEqual(rows[0].animalCounts, { cow: null, buffalo: null, sheepGoat: null })
  assert.equal(rows[0].purchasedKg, undefined)
})

test('groups the same producer across centers and species without merging different producer codes by name', () => {
  const rows = buildVeterinaryProducerList([
    group('MILK-COW', [row('1', 'p1'), row('2', 'P1'), row('3', 'p2')]),
    group('MILK-SHEEP', [row('4', 'p1')]), group('MILK-GOAT', [row('5', 'p1')]), group('MILK-BUFF', [row('6', 'p3')]),
  ], '2026-08')
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.find(row => row.id === 'producer:p1').animalGroups, ['cow', 'sheepGoat'])
  assert.deepEqual(rows.find(row => row.id === 'producer:p1').liters, { cow: 20, buffalo: 0, sheepGoat: 20 })
  assert.deepEqual(rows.find(row => row.id === 'producer:p3').animalGroups, ['buffalo'])
  assert.equal(veterinaryAnimalGroups.length, 3)
})

test('includes approved aviz-only producers like APIA and excludes pending approvals and other months', () => {
  const approval = { approvalId: 'a1', monthKey: '2026-08', producerName: 'Aviz producer', producerCode: 'p1', milkType: 'MILK-COW', approvedLiters: 50, status: 'APPROVED' }
  const rows = buildVeterinaryProducerList([], '2026-08', [approval, { ...approval, producerCode: 'p2', status: 'PENDING' }, { ...approval, producerCode: 'p3', monthKey: '2026-07' }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'aviz')
  assert.deepEqual(rows[0].animalGroups, ['cow'])
  assert.equal(rows[0].liters.cow, 50)
})

test('unmatched producers and missing milk types remain visible for review; no guessed ERP data', () => {
  const rows = buildVeterinaryProducerList([group('', [row('1', null), row('2', null)])], '2026-08', [], [{ producerCode: 'p1', county: 'CLUJ', trn: '123' }])
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => row.warning === 'No ERP match' && row.taxId === null && row.animalGroups.length === 0))
  assert.ok(rows.every(row => row.hasUnclassifiedMilk))
})

test('blank, invalid or empty months yield no rows', () => {
  const groups = [group('MILK-COW', [row('1', 'p1')])]
  for (const month of ['', '2026-13', '2026-09']) assert.deepEqual(buildVeterinaryProducerList(groups, month), [])
})

test('liters retain decimals, combine sheep and goat, and never double count same-type journal and approval', () => {
  const approval = (approvalId, milkType, approvedLiters) => ({ approvalId, monthKey: '2026-09', producerName: 'Producer', producerCode: 'P1', milkType, approvedLiters, status: 'APPROVED' })
  const rows = buildVeterinaryProducerList([
    group('MILK-COW', [row('1', 'p1', 123.456), row('2', 'P1', 10.125)], '2026-09'),
    group('MILK-SHEEP', [row('3', 'p1', 15.25)], '2026-09'),
    group('MILK-COW', [row('4', 'p1', 9999)], '2026-08'),
  ], '2026-09', [approval('a1', 'MILK-COW', 500), approval('a2', 'MILK-BUFF', 22.5), approval('a3', 'MILK-BUFF', 22.5), approval('a4', 'MILK-GOAT', 4.75)])
  assert.equal(rows.length, 1)
  assert.ok(Math.abs(rows[0].liters.cow - 133.581) < 1e-9)
  assert.equal(rows[0].liters.buffalo, 22.5)
  assert.equal(rows[0].liters.sheepGoat, 20)
  assert.equal(rows[0].hasUnclassifiedMilk, false)
})

test('quantities remain separate for unmatched producers with identical names', () => {
  const rows = buildVeterinaryProducerList([group('MILK-COW', [row('1', null, 12), row('2', null, 23)])], '2026-08')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(row => row.liters.cow), [12, 23])
})

test('animal counts follow effective months and producer codes, without adding producers or guessing unknown counts', () => {
  const counts = [
    { producerCode: 'P1', effectiveMonth: '2026-10', cowCount: 7, buffaloCount: null, sheepGoatCount: null },
    { producerCode: 'p1', effectiveMonth: '2026-08', cowCount: 4, buffaloCount: null, sheepGoatCount: null },
    { producerCode: 'p2', effectiveMonth: '2026-08', cowCount: 9, buffaloCount: null, sheepGoatCount: null },
  ]
  for (const [month, expected] of [['2026-07', null], ['2026-08', 4], ['2026-09', 4], ['2026-10', 7], ['2027-01', 7]]) {
    const rows = buildVeterinaryProducerList([group('MILK-COW', [row('1', ' p1 '), row('2', null)], month)], month, [], [], counts)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.find(row => row.producerCode.trim() === 'p1').animalCounts, { cow: expected, buffalo: null, sheepGoat: null })
    assert.equal(rows.find(row => !row.producerCode).animalCounts.cow, null)
  }
})

test('new monthly producers appear as missing, saved counts complete only the relevant species', () => {
  const groups = [group('MILK-COW', [row('1', 'p1'), row('2', 'p2')], '2026-10'), group('MILK-BUFF', [row('3', 'p1')], '2026-10')]
  const counts = [{ producerCode: 'p1', effectiveMonth: '2026-08', cowCount: 4, buffaloCount: null, sheepGoatCount: null, version: '0x000000000000000A' }]
  const rows = buildVeterinaryProducerList(groups, '2026-10', [], [], counts)
  assert.equal(rows.length, 2)
  assert.ok(rows.every(hasMissingVeterinaryCounts))
  const existing = rows.find(row => row.producerCode === 'p1')
  assert.equal(existing.countEffectiveMonth, '2026-08')
  assert.equal(existing.countVersion, counts[0].version)
  counts.push({ producerCode: 'p2', effectiveMonth: '2026-10', cowCount: 3, buffaloCount: null, sheepGoatCount: null })
  const updated = buildVeterinaryProducerList(groups, '2026-10', [], [], counts)
  assert.equal(hasMissingVeterinaryCounts(updated.find(row => row.producerCode === 'p2')), false)
})
