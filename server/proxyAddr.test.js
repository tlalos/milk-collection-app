import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import test from 'node:test'
import express from 'express'

// Resolve exactly the copy used by Express, including a nested dependency.
const require = createRequire(import.meta.url)
const expressRequire = createRequire(require.resolve('express'))
const proxyaddr = expressRequire('proxy-addr')

test('IPv4 clients are not trusted by short IPv4-mapped IPv6 subnets', () => {
  for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
    const trust = proxyaddr.compile(subnet)
    assert.equal(trust('198.51.100.42'), false, subnet)
    assert.equal(trust('::ffff:198.51.100.42'), false, subnet)
    const request = { socket: { remoteAddress: '198.51.100.42' }, headers: { 'x-forwarded-for': '10.1.2.3' } }
    assert.equal(proxyaddr(request, trust), '198.51.100.42', 'untrusted client cannot supply its own trusted address')
  }
})

test('valid IPv4 and IPv4-mapped trust ranges keep working', () => {
  for (const subnet of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
    const trust = proxyaddr.compile(subnet)
    assert.equal(trust('10.1.2.3'), true)
    assert.equal(trust('::ffff:10.1.2.3'), true)
    assert.equal(trust('198.51.100.42'), false)
    assert.equal(trust('::ffff:198.51.100.42'), false)
  }
})

test('IPv6 and trusted loopback proxy chains still resolve correctly', () => {
  const ipv6 = proxyaddr.compile('2001:db8:1::/48')
  assert.equal(ipv6('2001:db8:1::42'), true)
  assert.equal(ipv6('2001:db8:2::42'), false)
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.42' } }
  assert.equal(proxyaddr(request, proxyaddr.compile('loopback')), '198.51.100.42')
})

test('Express default trust ignores forged forwarding headers and still parses requests', async () => {
  const app = express()
  app.use(express.json())
  app.post('/test', (request, response) => response.json({ ip: request.ip, ips: request.ips, body: request.body, query: request.query }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    assert.equal(app.get('trust proxy'), false)
    const response = await fetch(`http://127.0.0.1:${server.address().port}/test?month=2026-08`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.1.2.3' }, body: JSON.stringify({ testOnly: true }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ip: '127.0.0.1', ips: [], body: { testOnly: true }, query: { month: '2026-08' } })
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  }
})
