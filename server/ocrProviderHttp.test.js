import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { createOcrProviderClient } from './ocrProviderHttp.js'

let server
let baseUrl
let client
const requests = []

before(async () => {
  // All requests stay on loopback; no credentials or documents leave the machine.
  server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({ path: request.url, method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString() })
    if (request.url === '/hang') return
    if (request.url === '/disconnect') return request.socket.destroy()
    if (request.url === '/error') {
      response.writeHead(429, { 'Content-Type': 'application/json' })
      return response.end(JSON.stringify({ error: { message: 'Rate limit reached' } }))
    }
    if (request.url === '/plain-error') {
      response.writeHead(503)
      return response.end('Unavailable')
    }
    if (request.url === '/invalid-json') return response.end('Not JSON')
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'test result' } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
  client = createOcrProviderClient(5000)
})

after(async () => {
  await client?.agent.destroy()
  if (!server) return
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
})

test('provider request preserves method, authorization, JSON payload and response', async () => {
  const body = JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'test' }] })
  const response = await client.fetchJson(`${baseUrl}/success`, {
    method: 'POST', headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' }, body,
  }, 'Test provider')
  assert.equal(response.choices[0].message.content, 'test result')
  const request = requests.at(-1)
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.authorization, 'Bearer test-only')
  assert.equal(request.headers['content-type'], 'application/json')
  assert.equal(request.body, body)
})

test('provider rejection retains its message and is not retried', async () => {
  const before = requests.length
  await assert.rejects(client.fetchJson(`${baseUrl}/error`, { method: 'POST' }, 'Test provider'),
    { message: 'Test provider API error: Rate limit reached' })
  assert.equal(requests.length, before + 1)
})

test('non-JSON provider error retains its HTTP status text', async () => {
  await assert.rejects(client.fetchJson(`${baseUrl}/plain-error`, {}, 'Test provider'),
    { message: 'Test provider API error: Service Unavailable' })
})

test('invalid JSON keeps the existing empty-payload fallback', async () => {
  assert.deepEqual(await client.fetchJson(`${baseUrl}/invalid-json`, {}, 'Test provider'), {})
})

test('stalled request times out and subsequent requests still work', async () => {
  const shortClient = createOcrProviderClient(100)
  try {
    await assert.rejects(shortClient.fetchJson(`${baseUrl}/hang`, {}, 'Test provider'),
      { message: 'Test provider OCR timed out after 0 minutes.' })
  } finally {
    await shortClient.agent.destroy()
  }
  assert.ok((await client.fetchJson(`${baseUrl}/success`, {}, 'Test provider')).choices)
})

test('disconnected POST reports a network error without retrying', async () => {
  const before = requests.length
  await assert.rejects(client.fetchJson(`${baseUrl}/disconnect`, { method: 'POST' }, 'Test provider'),
    /Test provider network request failed: UND_ERR_SOCKET/)
  assert.equal(requests.length, before + 1)
})

test('Agent also supports the direct-fetch path used by compatible providers', async () => {
  const response = await fetch(`${baseUrl}/direct`, {
    method: 'POST', body: '{}', dispatcher: client.agent, signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.status, 200)
  assert.ok((await response.json()).choices)
})
