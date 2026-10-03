import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createErpConnectionStore, normalizeErpUrl } from './erpConnectionStore.js'

test('ERP base URLs are normalized and reject embedded credentials or non-HTTP URLs', () => {
  assert.equal(normalizeErpUrl(' https://ERP.example/api/// '), 'https://erp.example/api')
  for (const url of ['', 'file:///etc/passwd', 'https://user:pass@erp.example/api', 'https://erp.example/api?x=1', 'https://erp.example/api#x']) {
    assert.throws(() => normalizeErpUrl(url))
  }
})

test('shared settings override legacy environment and persist only the URL', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'milk-erp-settings-'))
  const file = path.join(directory, 'erp.json')
  let legacy = 'https://legacy.example/api'
  const store = createErpConnectionStore(file, () => legacy)
  try {
    assert.equal((await store.get()).serverUrl, legacy)
    await store.save('https://shared.example/api/')
    legacy = ''
    assert.deepEqual(await store.get(), { serverUrl: 'https://shared.example/api' })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { serverUrl: 'https://shared.example/api' })
    await assert.rejects(store.save('file:///bad'))
    assert.equal((await store.get()).serverUrl, 'https://shared.example/api')
    await writeFile(file, 'invalid json')
    await assert.rejects(store.get())
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('new installations have no implicit ERP destination', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'milk-erp-settings-'))
  try {
    assert.deepEqual(await createErpConnectionStore(path.join(directory, 'missing.json'), () => '').get(), { serverUrl: '' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
