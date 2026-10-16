import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { currentMilkDate, milkDocumentDateError, assertMilkDocumentDate, assertCurrentMilkDateAccess } from './milkDocumentDate.js'

const now = new Date('2026-10-15T12:00:00Z')
test('today and earlier dates are allowed; tomorrow and invalid dates are rejected', () => {
  for (const label of ['Reception', 'Delivery']) {
    for (const day of ['2026-10-15', '2026-10-14', '2024-02-29']) {
      assert.equal(milkDocumentDateError(day, label, now), '')
    }
    for (const day of ['2026-10-16', '2027-01-01', '2026-02-30', '', '15/10/2026', '0000-01-01']) {
      assert.throws(() => assertMilkDocumentDate(day, label, now), error => error.status === 400 && error.message.startsWith(label))
    }
  }
})

test('Romanian calendar boundary works across midnight, year rollover and daylight saving', () => {
  for (const [instant, date] of [
    ['2026-10-15T20:59:59Z', '2026-10-15'],
    ['2026-10-15T21:00:00Z', '2026-10-16'],
    ['2026-12-31T21:59:59Z', '2026-12-31'],
    ['2026-12-31T22:00:00Z', '2027-01-01'],
    ['2026-03-29T21:00:00Z', '2026-03-30'],
    ['2026-10-25T21:00:00Z', '2026-10-25'],
  ]) assert.equal(currentMilkDate(new Date(instant)), date)
})

for (const kind of ['Reception', 'Delivery']) {
  test(`${kind} create and update reject future dates before database writes, including drafts`, async () => {
    const source = await readFile(new URL(`./milk${kind}Store.js`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile('store.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const dateField = kind === 'Reception' ? 'receptionDate' : 'deliveryDate'
    for (const operation of ['create', 'update']) {
      const name = `${operation}Milk${kind}`
      const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name.text === name).getText(ast).replace(/^export /, '')
      let sqlAccess = 0
      const context = {
        assertCurrentMilkDateAccess,
        currentMilkDate: () => currentMilkDate(now),
        assertMilkDocumentDate: (date, label) => assertMilkDocumentDate(date, label, now),
        [`initializeMilk${kind}Store`]: async () => {},
        [`getMilk${kind}`]: async () => ({ [dateField]: '2026-10-14' }),
        getPool: async () => { sqlAccess++; throw new Error('Unexpected database write path') },
      }
      vm.createContext(context); vm.runInContext(fn, context)
      const input = { [dateField]: '2026-10-16', status: 'DRAFT' }
      await assert.rejects(() => operation === 'create' ? context[name](input) : context[name]('existing', input), error => error.status === 400 && /later than today/.test(error.message))
      assert.equal(sqlAccess, 0)
    }
  })
}
