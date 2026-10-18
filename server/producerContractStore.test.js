import test from 'node:test'
import assert from 'node:assert/strict'
import { planProducerContractImport, validateProducerContracts, validateProducerContractEdit, checkProducerContractEdit } from './producerContractStore.js'
import { readFile } from 'node:fs/promises'

const row = (overrides = {}) => ({ producerCode: 'P001', milkType: 'MILK-COW', contractNumber: '001/26', contractStartDate: '2026-06-01', contractEndDate: '2027-06-01', contractedKg: 12345.678, sourceRow: 2, ...overrides })
const producers = [{ producerCode: 'p001' }]

const edit = (overrides = {}) => validateProducerContractEdit({ ...row(), contractId: null, expectedVersion: null, ...overrides })
const saved = { ...row(), producerCode: 'p001', contractId: 1, version: '0x0000000000000001' }

test('manual edits validate all fields and require a version for existing contracts', () => {
  assert.equal(edit().producerCode, 'p001')
  for (const invalid of [{ contractId: 1 }, { expectedVersion: 'anything' }, { contractNumber: '' },
    { contractStartDate: '2026-02-30' }, { contractedKg: -1 }, { contractedKg: 1.2345 }, { contractedKg: '100' }]) {
    assert.throws(() => edit(invalid), error => error.status === 400)
  }
  assert.equal(edit({ contractId: 1, expectedVersion: saved.version }).contractId, '1')
})

test('manual edits prevent overlaps, stale versions and identity changes', () => {
  const update = edit({ contractId: 1, expectedVersion: saved.version, contractNumber: 'corrected' })
  assert.equal(checkProducerContractEdit(update, [saved]), saved)
  for (const [change, existing] of [[edit(), [saved]], [{ ...update, expectedVersion: '0x0000000000000002' }, [saved]],
    [{ ...update, producerCode: 'p002' }, [saved]], [update, []]]) {
    assert.throws(() => checkProducerContractEdit(change, existing), error => error.status === 409)
  }
  assert.equal(checkProducerContractEdit(edit({ contractStartDate: '2027-06-02', contractEndDate: '2028-06-01' }), [saved]), null)
  assert.equal(checkProducerContractEdit(edit({ milkType: 'MILK-SHEEP' }), [saved]), null)
})

test('manual saves audit within the transaction and roll back unknown producers or audit failures', async () => {
  const source = await readFile(new URL('./producerContractStore.js', import.meta.url), 'utf8')
  const functionSource = source.slice(source.indexOf('export async function saveProducerContract(')).replace('export ', '')
  for (const scenario of ['update', 'insert', 'unknown', 'audit-failure']) {
    const queries = [], events = []
    const transaction = { begin: async level => events.push(level), commit: async () => events.push('commit'), rollback: async () => events.push('rollback') }
    const mockSql = { Transaction: function () { return transaction }, ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' },
      NVarChar: () => null, Decimal: () => null, Request: function (owner) {
        assert.equal(owner, transaction)
        this.input = () => this
        this.query = async query => {
          queries.push(query)
          if (query.includes('UPDLOCK')) return { recordset: scenario === 'insert' || scenario === 'unknown' ? [] : [saved] }
          if (query.includes('producersJson')) return { recordset: [{ producersJson: JSON.stringify(scenario === 'unknown' ? [] : producers) }] }
          if (query.includes('INSERT INTO dbo.AppAuditLog') && scenario === 'audit-failure') throw new Error('audit failed')
          return { recordset: [saved] }
        }
      } }
    const save = new Function('sql', 'validateProducerContractEdit', 'initializeProducerContracts', 'getProducerContractPool', 'selectProducerContractsSql', 'checkProducerContractEdit', 'code', 'editError', 'insertProducerContract', 'createHash', `${functionSource}; return saveProducerContract`)(
      mockSql, validateProducerContractEdit, async () => {}, async () => ({}), 'SELECT * FROM dbo.ProducerContracts', checkProducerContractEdit,
      value => value.toLowerCase(), message => new Error(message), async owner => { assert.equal(owner, transaction); events.push('insert') },
      () => ({ update() { return this }, digest() { return 'hash' } }))
    const input = scenario === 'insert' || scenario === 'unknown' ? edit() : edit({ contractId: 1, expectedVersion: saved.version })
    const promise = save(input, { id: 'test', username: 'tester' })
    if (scenario === 'unknown' || scenario === 'audit-failure') { await assert.rejects(promise); assert.equal(events.at(-1), 'rollback') }
    else { assert.equal(await promise, saved); assert.equal(events.at(-1), 'commit'); assert.ok(queries.some(query => query.includes('INSERT INTO dbo.AppAuditLog'))) }
    assert.equal(events[0], 'serializable')
    if (scenario === 'unknown') assert.ok(!events.includes('insert'))
  }
})

test('contract import normalizes producer codes without changing contract numbers or quantities', () => {
  const normalized = validateProducerContracts([row()])[0]
  assert.equal(normalized.producerCode, 'p001')
  assert.equal(normalized.contractNumber, '001/26')
  assert.equal(normalized.contractedKg, 12345.678)
})

test('invalid dates, missing numbers, precision loss and duplicate identities are rejected', () => {
  for (const invalid of [{ producerCode: '' }, { milkType: 'COW' }, { contractNumber: '' }, { contractStartDate: '2026-02-30' },
    { contractEndDate: '2025-06-01' }, { contractedKg: 0 }, { contractedKg: NaN }, { contractedKg: 1.2345 }, { sourceRow: 0 }]) {
    assert.throws(() => validateProducerContracts([row(invalid)]))
  }
  assert.throws(() => validateProducerContracts([row(), row({ producerCode: 'p001', sourceRow: 3 })]), /duplicate/)
})

test('identical imports skip all saved records, changed or overlapping contracts conflict', () => {
  const existing = validateProducerContracts([row()])
  assert.equal(planProducerContractImport([row()], existing, producers).unchanged.length, 1)
  for (const changed of [{ contractNumber: '2' }, { contractedKg: 999 }, { contractEndDate: '2028-01-01' }, { contractStartDate: '2027-06-01', contractEndDate: '2028-06-01' }]) {
    const plan = planProducerContractImport([row(changed)], existing, producers)
    assert.equal(plan.insert.length, 0)
    assert.equal(plan.conflicts.length, 1)
  }
})

test('renewals preserve previous contracts and milk types stay independent', () => {
  const existing = validateProducerContracts([row()])
  const renewal = row({ contractStartDate: '2027-06-02', contractEndDate: '2028-06-01' })
  const plan = planProducerContractImport([renewal, row({ milkType: 'MILK-SHEEP' })], existing, producers)
  assert.equal(plan.insert.length, 2)
  assert.equal(plan.conflicts.length, 0)
  assert.equal(existing.length, 1)
  assert.equal(existing[0].contractStartDate, '2026-06-01')
})

test('unknown producer codes and overlapping incoming records cannot be silently imported', () => {
  assert.equal(planProducerContractImport([row()], [], []).conflicts.length, 1)
  const plan = planProducerContractImport([row(), row({ contractStartDate: '2026-07-01', sourceRow: 3 })], [], producers)
  assert.equal(plan.conflicts.length, 1)
})
