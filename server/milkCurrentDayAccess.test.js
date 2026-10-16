import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { assertCurrentMilkDateAccess, currentMilkDate, assertMilkDocumentDate } from './milkDocumentDate.js'

const now = new Date('2026-10-16T12:00:00Z')
const guard = (before, after, restricted) => assertCurrentMilkDateAccess(before, after, restricted, now)
test('staff can only work today; admins retain past access; midnight locks yesterday', () => {
  assert.doesNotThrow(() => guard('2026-10-16', '2026-10-16', true))
  assert.doesNotThrow(() => guard(undefined, '2026-10-16', true))
  for (const [before, after] of [['2026-10-15', undefined], ['2026-10-15', '2026-10-16'], ['2026-10-16', '2026-10-15'], [undefined, '2026-10-15']]) {
    assert.throws(() => guard(before, after, true), error => error.status === 403)
    assert.doesNotThrow(() => guard(before, after, false))
  }
  assert.throws(() => assertCurrentMilkDateAccess('2026-10-16', undefined, true, new Date('2026-10-16T21:00:00Z')), error => error.status === 403)
})

for (const kind of ['Reception', 'Delivery']) {
  test(`${kind} stores reject staff past create, update and delete before writes`, async () => {
    const text = await readFile(new URL(`milk${kind}Store.js`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile('store.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const field = kind === 'Reception' ? 'receptionDate' : 'deliveryDate'
    for (const operation of ['create', 'update', 'delete']) {
      const name = `${operation}Milk${kind}`
      const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name.text === name).getText(ast).replace(/^export /, '')
      for (const date of ['2026-10-15', '2026-10-16']) {
        let stored = '2026-10-15'
        let writes = 0
        const allowed = new Error('Passed date guard')
        const context = {
          currentMilkDate: () => currentMilkDate(now), assertCurrentMilkDateAccess: guard,
          assertMilkDocumentDate: (value, label) => assertMilkDocumentDate(value, label, now),
          [`initializeMilk${kind}Store`]: async () => {},
          [`getMilk${kind}`]: async () => ({ [field]: stored, milkType: 'COW' }),
          getPool: async () => { writes++; throw allowed }, getMilkDensityFactor: async () => { throw allowed },
        }
        vm.createContext(context); vm.runInContext(fn, context)
        const invoke = restricted => operation === 'create' ? context[name]({ [field]: date }, 'staff', restricted)
          : operation === 'delete' ? context[name]('record', restricted)
            : context[name]('record', { [field]: date, milkType: 'OTHER' }, 'staff', restricted)
        if (operation !== 'create' || date !== '2026-10-16') {
          await assert.rejects(() => invoke(true), error => error.status === 403)
          assert.equal(writes, 0)
        }
        await assert.rejects(() => invoke(false), error => error === allowed)
        if (operation === 'update') {
          stored = '2026-10-16'
          if (date === '2026-10-15') await assert.rejects(() => invoke(true), error => error.status === 403)
          else await assert.rejects(() => invoke(true), error => error === allowed)
        }
      }
    }
    assert.match(text, /@currentDateOnly = 0 OR \(\w+Date = @editableDate AND @\w+Date = @editableDate\)/)
    assert.match(text, /DELETE FROM dbo\.\w+ WHERE \w+Id = @\w+Id AND \(@currentDateOnly = 0 OR \w+Date = @editableDate\)/)
  })
}

test('all six write endpoints derive restriction from authenticated admin flag, never request body', async () => {
  const source = await readFile(new URL('index.js', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('index.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  for (const kind of ['Reception', 'Delivery']) for (const [method, operation] of [['post', 'create'], ['patch', 'update'], ['delete', 'delete']]) {
    const path = `/api/milk-${kind === 'Reception' ? 'receptions' : 'deliveries'}${method === 'post' ? '' : '/:id'}`
    const route = ast.statements.find(s => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && s.expression.expression.name?.text === method && s.expression.arguments[0]?.text === path)
    for (const user of [{ username: 'staff' }, { username: 'manager', permissions: ['app_admin'] }, { username: 'admin', isAdmin: true }]) {
      let handler, args
      const context = { app: { [method]: (_path, callback) => { handler = callback } },
        [`${operation}Milk${kind}`]: async (...values) => { args = values; return method === 'delete' ? true : { receptionDate: '2026-10-16' } },
        [`getMilk${kind}`]: async () => ({ receptionDate: '2026-10-15' }),
        refreshSavedDailyLinks: async () => '', attachMilkReceptionReconciliations: async rows => rows,
        auditAction: async () => {}, auditFailureReason: error => error.message }
      vm.runInNewContext(route.getText(ast), context)
      const res = { status() { return this }, json() {} }
      await handler({ authUser: user, params: { id: 'test' }, body: { isAdmin: true, currentDateOnly: false } }, res, error => { throw error })
      assert.equal(args.at(-1), user.isAdmin !== true)
    }
  }
})
