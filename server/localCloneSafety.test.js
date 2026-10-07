import test from 'node:test'
import assert from 'node:assert/strict'
import { installLocalCloneNetworkGuard, localCloneMiddleware } from './localCloneSafety.js'

test('normal environments keep their network and API behavior', async () => {
  const target = { fetch: async () => 'ok' }
  installLocalCloneNetworkGuard(false, target)
  assert.equal(await target.fetch(), 'ok')
  let next = false
  localCloneMiddleware(false)({ method: 'POST', path: '/api/ocr/send' }, {}, () => { next = true })
  assert.equal(next, true)
})

test('clone blocks outbound HTTP before making a network request', async () => {
  let called = false
  const target = { fetch: async () => { called = true } }
  installLocalCloneNetworkGuard(true, target)
  await assert.rejects(target.fetch('http://127.0.0.1:8102/wmsapi/api'), /disabled/)
  assert.equal(called, false)
})

test('clone allows reads and local sign-in but blocks business mutations and ERP sends', () => {
  for (const [method, path, allowed] of [
    ['GET', '/api/ocr/exports/apia-rows', true], ['POST', '/api/auth/login', true],
    ['POST', '/api/auth/logout', true], ['POST', '/api/ocr/monthly-invoices/send', false],
    ['PATCH', '/api/ocr/settings', false], ['DELETE', '/api/ocr/jobs/1', false],
    ['POST', '/api/web-users/roles', false],
  ]) {
    let next = false
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(value) { this.code = value; return this }, json(value) { this.body = value; return this } }
    localCloneMiddleware(true, false)({ method, path }, response, () => { next = true })
    assert.equal(next, allowed)
    assert.equal(response.headers['X-Milk-Local-Clone'], 'read-only')
    if (!allowed) assert.equal(response.code, 423)
  }
})

test('explicit local herd edit exception allows only the authenticated count PUT route', () => {
  for (const [method, path, allowed] of [
    ['PUT', '/api/ocr/exports/producer-herd-counts', true],
    ['DELETE', '/api/ocr/exports/producer-herd-counts', false],
    ['POST', '/api/ocr/monthly-invoices/send', false],
    ['PATCH', '/api/ocr/settings', false],
  ]) {
    let next = false
    const response = { setHeader() {}, status() { return this }, json() {} }
    localCloneMiddleware(true, true)({ method, path }, response, () => { next = true })
    assert.equal(next, allowed)
  }
})
