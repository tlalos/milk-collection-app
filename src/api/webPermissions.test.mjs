import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const built = await build({ entryPoints: ['src/api/webPermissions.ts'], bundle: true, write: false, format: 'esm', platform: 'node', define: { 'import.meta.env.BASE_URL': '"/milk/"', 'import.meta.env.DEV': 'false' } })
const { requireWebOperation } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)

test('legacy browser ERP sends recheck the current web grant and fail closed', async t => {
  let user = { permissions: ['milk_collection'], writePermissions: [] }, status = 200, calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++
    assert.equal(url, '/milk/api/auth/session')
    assert.equal(options.cache, 'no-store')
    return new Response(JSON.stringify({ user }), { status })
  })
  await assert.rejects(requireWebOperation('milk_collection'), /edit \/ operate/)
  user = { permissions: ['milk_collection'], writePermissions: ['milk_collection'] }
  await requireWebOperation('milk_collection')
  user.writePermissions = []
  await assert.rejects(requireWebOperation('milk_collection'), /edit \/ operate/)
  user = { isAdmin: true }
  await requireWebOperation('milk_collection')
  status = 401
  await assert.rejects(requireWebOperation('milk_collection'), /Sign in/)
  assert.equal(calls, 5)
})
