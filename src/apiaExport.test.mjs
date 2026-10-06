import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const built = await build({ entryPoints: ['src/apiaExport.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { apiaColumns, buildApiaProducerList } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const row = (id, producerCode, producer, liters, producerWarning = null) => ({ id, producerCode, producer, liters, producerWarning })

test('contains all fourteen Excel template columns in their original order', () => {
  assert.deepEqual(apiaColumns.map(column => column.label), [
    'Nume si prenume/ Denumire producator', 'Tara', 'Judet', 'CNP/CUI', 'Cod exploatatie', 'Numar contract',
    'Data incheierii contractului\nzz/ll/aaaa', 'Data incetarii contractului\nzz/ll/aaaa',
    'Cantitate de lapte contractata(total - kg)', 'Cantitate de lapte achizitionata - kg',
    'Cod unic identificare APIA', 'Procent de grasime (%)', 'Procent de proteina (%)', 'Este lapte ecologic? (DA sau NU)',
  ])
  assert.equal(new Set(apiaColumns.map(column => column.key)).size, 14)
})

test('uses only positive journal quantities for the selected month', () => {
  const groups = [
    { month: '2026-08', monthlyRows: [row('1', 'P1', 'Ana', 20), row('2', 'P2', 'Zero', 0), row('3', 'P3', 'Missing', null), row('4', 'P4', 'Invalid', NaN), row('5', 'P5', 'Negative', -1)] },
    { month: '2026-07', monthlyRows: [row('6', 'P6', 'July', 10)] },
  ]
  assert.deepEqual(buildApiaProducerList(groups, '2026-08').map(r => r.producer), ['Ana'])
  assert.deepEqual(buildApiaProducerList(groups, '2026-09'), [])
})

test('groups by linked producer code across centers and retains warnings', () => {
  const result = buildApiaProducerList([
    { month: '2026-08', monthlyRows: [row('1', 'P1', 'Ana', 20)] },
    { month: '2026-08', monthlyRows: [row('2', ' p1 ', 'Ana', 10, 'Wrong center'), row('3', 'P2', 'Ana', 15)] },
  ], '2026-08')
  assert.equal(result.length, 2)
  assert.equal(result[0].warning, 'Wrong center')
  assert.equal(result[0].country, null)
})

test('unmatched names are visible and never merged by name', () => {
  const result = buildApiaProducerList([{ month: '2026-08', monthlyRows: [row('1', null, 'Ana', 20), row('2', null, 'Ana', 10), row('3', 'C1', null, 30)] }], '2026-08')
  assert.equal(result.length, 3)
  assert.ok(result.every(r => r.warning === 'No ERP match' && r.producerCode === ''))
})

test('filters milk type before grouping producers and warnings', () => {
  const groups = [
    { month: '2026-08', milkType: 'MILK-COW', monthlyRows: [row('1', 'P1', 'Ana', 20)] },
    { month: '2026-08', milkType: 'MILK-SHEEP', monthlyRows: [row('2', 'P1', 'Ana', 10, 'Wrong center'), row('3', 'P2', 'Maria', 15)] },
    { month: '2026-07', milkType: 'MILK-COW', monthlyRows: [row('4', 'P3', 'July', 20)] },
    { month: '2026-08', milkType: 'Unassigned milk type', monthlyRows: [row('5', 'P4', 'Unknown type', 20)] },
  ]
  const cows = buildApiaProducerList(groups, '2026-08', 'MILK-COW')
  assert.equal(cows.length, 1)
  assert.equal(cows[0].warning, null)
  assert.equal(buildApiaProducerList(groups, '2026-08', 'MILK-SHEEP').length, 2)
  assert.equal(buildApiaProducerList(groups, '2026-08', '').length, 3)
  assert.deepEqual(buildApiaProducerList(groups, '2026-08', 'MILK-GOAT'), [])
})

const approval = (overrides = {}) => ({ approvalId: 'a1', monthKey: '2026-08', producerCode: 'P9', producerName: 'Aviz producer', milkType: 'MILK-COW', approvedLiters: 174, status: 'APPROVED', ...overrides })

test('includes approved aviz-only producers for the selected month and milk type', () => {
  const approvals = [approval(), approval({ approvalId: 'a2', producerCode: 'P10', milkType: 'MILK-SHEEP' }), approval({ monthKey: '2026-07' })]
  const result = buildApiaProducerList([], '2026-08', 'MILK-COW', approvals)
  assert.equal(result.length, 1)
  assert.equal(result[0].producerCode, 'P9')
  assert.equal(result[0].source, 'aviz')
  assert.equal(buildApiaProducerList([], '2026-08', '', approvals).length, 2)
})

test('excludes inactive approvals and non-positive or missing approved quantities', () => {
  for (const overrides of [{ status: 'NEEDS_REVIEW' }, { status: 'CANCELLED' }, { status: 'PENDING' }, { approvedLiters: 0 }, { approvedLiters: -1 }, { approvedLiters: null }, { approvedLiters: NaN }]) {
    assert.deepEqual(buildApiaProducerList([], '2026-08', '', [approval(overrides)]), [])
  }
})

test('deduplicates approved aviz against journals by producer code without clearing warnings', () => {
  const groups = [{ month: '2026-08', milkType: 'MILK-COW', monthlyRows: [row('1', 'p9', 'Journal producer', 20, 'Wrong center')] }]
  const result = buildApiaProducerList(groups, '2026-08', 'MILK-COW', [approval(), approval({ approvalId: 'a2' })])
  assert.equal(result.length, 1)
  assert.equal(result[0].source, 'journal')
  assert.equal(result[0].warning, 'Wrong center')
  assert.equal(buildApiaProducerList([], '2026-08', '', [approval(), approval({ approvalId: 'a2' })]).length, 1)
})

test('fills ERP identifiers by code for journal and approved aviz producers, preserving leading zeros', () => {
  const groups = [{ month: '2026-08', milkType: 'MILK-COW', monthlyRows: [row('1', 'p1', 'Journal name', 20)] }]
  const references = [
    { producerCode: ' P1 ', trn: ' 0012345678901 ', exploitationCode: ' RO0000123456 ' },
    { producerCode: 'p9', trn: '00987654', exploitationCode: 'RO0000987654' },
  ]
  const result = buildApiaProducerList(groups, '2026-08', 'MILK-COW', [approval()], references)
  const journal = result.find(r => r.producerCode === 'p1')
  const aviz = result.find(r => r.producerCode === 'P9')
  assert.equal(journal.taxId, '0012345678901')
  assert.equal(journal.exploitationCode, 'RO0000123456')
  assert.equal(journal.producer, 'Journal name')
  assert.equal(aviz.taxId, '00987654')
  assert.equal(aviz.exploitationCode, 'RO0000987654')
})

test('missing ERP fields and unlinked producers remain blank without name-based matching', () => {
  const groups = [{ month: '2026-08', monthlyRows: [row('1', 'P1', 'Ana', 20), row('2', null, 'Ana', 10), row('3', 'P3', 'Maria', 15)] }]
  const references = [{ producerCode: 'P1', trn: '', exploitationCode: '   ' }, { producerCode: 'P2', producerName: 'Ana', trn: '123', exploitationCode: 'RO123' }]
  const result = buildApiaProducerList(groups, '2026-08', '', [], references)
  assert.equal(result.length, 3)
  assert.ok(result.every(r => r.taxId === null && r.exploitationCode === null))
})

const receptionFactors = [
  { code: 'MILK-COW', densityFactor: 1.03 },
  { code: 'MILK-SHEEP', densityFactor: 1.036 },
  { code: 'MILK-BUFF', densityFactor: 1.04 },
]

test('uses the dedicated county field for journal and aviz producers, never legacy city', () => {
  const groups = [{ month: '2026-08', monthlyRows: [row('1', 'P1', 'Ana', 10), row('2', 'P2', 'Maria', 10), row('3', null, 'Ana', 10)] }]
  const references = [
    { producerCode: 'p1', county: ' CLUJ ', city: 'Cluj-Napoca' },
    { producerCode: 'p2', city: 'SALAJ' },
    { producerCode: 'p9', county: 'SALAJ', city: 'Zalau' },
  ]
  const result = buildApiaProducerList(groups, '2026-08', '', [approval()], references)
  assert.equal(result.find(r => r.producerCode === 'P1').county, 'CLUJ')
  assert.equal(result.find(r => r.producerCode === 'P2').county, null)
  assert.equal(result.find(r => r.producerCode === 'P9').county, 'SALAJ')
  assert.equal(result.find(r => r.producerCode === '').county, null)
})

test('sums journal liters and converts using supplied reception factors without early rounding', () => {
  const groups = [{ month: '2026-08', milkType: 'MILK-COW', monthlyRows: [row('1', 'P1', 'Ana', 1000), row('2', 'P1', 'Ana', 0.123)] }]
  const result = buildApiaProducerList(groups, '2026-08', 'MILK-COW', [], [], receptionFactors)[0]
  assert.ok(Math.abs(result.purchasedKg - 1030.12669) < 1e-9)
  assert.equal(result.missingReceptionFactor, false)
  const custom = buildApiaProducerList(groups, '2026-08', '', [], [], [{ code: 'MILK-COW', densityFactor: 1.031 }])[0]
  assert.ok(Math.abs(custom.purchasedKg - 1000.123 * 1.031) < 1e-9)
})

test('converts approved aviz quantities once and excludes duplicate approvals', () => {
  const result = buildApiaProducerList([], '2026-08', 'MILK-COW', [approval(), approval({ approvalId: 'a2' })], [], receptionFactors)[0]
  assert.ok(Math.abs(result.purchasedKg - 179.22) < 1e-9)
})

test('journal quantities override same-type approval, while all-types includes other milk types', () => {
  const groups = [{ month: '2026-08', milkType: 'MILK-COW', monthlyRows: [row('1', 'p9', 'Ana', 1000)] }]
  const approvals = [approval(), approval({ approvalId: 'a2', milkType: 'MILK-SHEEP', approvedLiters: 100 })]
  const all = buildApiaProducerList(groups, '2026-08', '', approvals, [], receptionFactors)
  assert.equal(all.length, 1)
  assert.ok(Math.abs(all[0].purchasedKg - 1133.6) < 1e-9)
  assert.equal(buildApiaProducerList(groups, '2026-08', 'MILK-COW', approvals, [], receptionFactors)[0].purchasedKg, 1030)
})

test('all-types converts each journal milk type separately before totaling', () => {
  const groups = [
    { month: '2026-08', milkType: 'MILK-COW', monthlyRows: [row('1', 'P1', 'Ana', 100)] },
    { month: '2026-08', milkType: 'MILK-BUFF', monthlyRows: [row('2', 'P1', 'Ana', 100)] },
  ]
  assert.equal(buildApiaProducerList(groups, '2026-08', '', [], [], receptionFactors)[0].purchasedKg, 207)
})

test('missing or invalid factors leave kilograms unavailable rather than reporting a partial total', () => {
  const groups = [{ month: '2026-08', milkType: 'MILK-COW', monthlyRows: [row('1', 'P1', 'Ana', 1000)] }]
  for (const densityFactor of [0, -1, NaN, Infinity, undefined]) {
    const result = buildApiaProducerList(groups, '2026-08', '', [], [], [{ code: 'MILK-COW', densityFactor }])[0]
    assert.equal(result.purchasedKg, null)
    assert.equal(result.missingReceptionFactor, true)
  }
  const unknown = { month: '2026-08', milkType: 'UNKNOWN', monthlyRows: [row('2', 'P1', 'Ana', 100)] }
  assert.equal(buildApiaProducerList([...groups, unknown], '2026-08', '', [], [], receptionFactors)[0].purchasedKg, null)
})
