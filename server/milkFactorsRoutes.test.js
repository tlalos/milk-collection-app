import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { createPermissionMiddleware } from './permissionMiddleware.js'
import { userHasPermission } from './appSecurityStore.js'
import { defaultMilkDensitySettings, validateMilkDensitySettings } from './milkDensitySettingsStore.js'

const source = await readFile(new URL('./index.js', import.meta.url), 'utf8')
const ast = ts.createSourceFile('index.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const routes = ast.statements.filter(s => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression)
  && s.expression.arguments[0]?.text === '/api/milk-factors').map(s => s.getText(ast)).join('\n')

async function request(method, user, settings = defaultMilkDensitySettings, saveError = null) {
  const registered = {}, writes = [], audits = []
  const { requirePermission } = createPermissionMiddleware({ getSessionUser: async () => user, sessionToken: () => 'test' })
  vm.runInNewContext(routes, {
    app: { get: (path, ...handlers) => { registered.get = handlers }, put: (path, ...handlers) => { registered.put = handlers } },
    requirePermission, userHasPermission, validateMilkDensitySettings,
    getMilkDensitySettings: async () => defaultMilkDensitySettings,
    saveMilkDensitySettings: async (input, username) => { if (saveError) throw saveError; writes.push({ input, username }); return input },
    auditAction: async value => audits.push(value), Error,
  })
  let allowed = false, failure
  const req = { body: { settings } }
  const res = { code: 200, status(code) { this.code = code; return this }, set() { return this }, json(value) { this.body = value; return this } }
  await registered[method][0](req, res, error => { failure = error; allowed = !error })
  if (allowed) await registered[method][1](req, res, error => { failure = error })
  return { res, writes, audits, failure }
}

test('reception users can view factors; administrators receive edit capability', async () => {
  assert.equal((await request('get', null)).res.code, 401)
  assert.equal((await request('get', { permissions: [] })).res.code, 403)
  assert.equal((await request('get', { permissions: ['milk_reception'] })).res.body.canEdit, false)
  assert.equal((await request('get', { permissions: ['milk_reception', 'app_admin'] })).res.body.canEdit, true)
  assert.equal((await request('get', { isAdmin: true })).res.body.canEdit, true)
})

test('write endpoint enforces administration permission, including direct requests', async () => {
  for (const user of [null, { permissions: ['milk_reception'] }]) {
    const result = await request('put', user)
    assert.equal(result.res.code, user ? 403 : 401)
    assert.equal(result.writes.length, 0)
    assert.equal(result.audits.length, 0)
  }
})

test('valid factors save with actor and before/after audit; invalid factors do not write', async () => {
  const user = { username: 'admin-test', isAdmin: true }
  const settings = structuredClone(defaultMilkDensitySettings)
  settings.RECEPTION[0].densityFactor = 1.031234
  const result = await request('put', user, settings)
  assert.equal(result.failure, undefined)
  assert.equal(result.writes[0].username, 'admin-test')
  assert.equal(result.res.body.settings.RECEPTION[0].densityFactor, 1.031234)
  assert.equal(result.res.body.settings.DELIVERIES[0].densityFactor, 1.029)
  assert.equal(result.audits[0].action, 'milk_factors.update')
  assert.equal(result.audits[0].before.RECEPTION[0].densityFactor, 1.03)
  assert.equal(result.audits[0].after.RECEPTION[0].densityFactor, 1.031234)
  settings.RECEPTION[0].densityFactor = 2
  const invalid = await request('put', user, settings)
  assert.equal(invalid.res.code, 400)
  assert.equal(invalid.writes.length, 0)
  const failed = await request('put', user, defaultMilkDensitySettings, new Error('Storage unavailable'))
  assert.equal(failed.failure.message, 'Storage unavailable')
  assert.equal(failed.audits.length, 0)
})
