import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const built = await build({ entryPoints: ['src/store/ocrConnectionSettingsStore.ts'], bundle: true, write: false, platform: 'node', format: 'esm', define: { 'import.meta.env': JSON.stringify({ BASE_URL: '/', DEV: true }) } })
const { ocrConnectionSettingsStore: store } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)

test('send settings use the shared URL and retain local credentials without uploading them', async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  try {
    store.set({ serverUrl: 'https://old.example/api', apiUsername: 'local', apiPassword: 'private', defaultFiscalYear: '2026' })
    const calls = []
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, json: async () => ({ serverUrl: 'https://shared.example/api' }) }
    }
    const resolved = await store.resolve()
    assert.equal(resolved.serverUrl, 'https://shared.example/api')
    assert.equal(resolved.apiPassword, 'private')
    assert.equal(calls[0].options.body, undefined)
    await store.saveShared(resolved)
    assert.deepEqual(JSON.parse(calls[1].options.body), { serverUrl: 'https://shared.example/api' })
    assert.equal(store.get().apiUsername, 'local')
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'Permission denied' }) })
    await assert.rejects(store.saveShared({ ...resolved, serverUrl: 'https://other.example/api' }), /Permission denied/)
    assert.equal(store.get().serverUrl, 'https://shared.example/api')
    await assert.rejects(store.resolve(), /Permission denied/)
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ serverUrl: '' }) })
    await assert.rejects(store.resolve(), /Save the shared ERP URL/)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.localStorage = originalStorage
  }
})
