import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const tenantId = process.env.AZURE_TENANT_ID || 'organizations'
const clientId = process.env.AZURE_CLIENT_ID
const scopes = process.env.GRAPH_SCOPES || 'Files.ReadWrite offline_access'
const cachePath = path.resolve(process.env.EXCEL_GRAPH_TOKEN_CACHE || '.graph-token-cache.json')

if (!clientId) {
  throw new Error('AZURE_CLIENT_ID is missing from .env.')
}

async function postForm(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

const deviceEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/devicecode`
const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`

const { response: deviceResponse, payload: device } = await postForm(deviceEndpoint, {
  client_id: clientId,
  scope: scopes,
})

if (!deviceResponse.ok) {
  throw new Error(device.error_description || device.error || `Device-code request failed (${deviceResponse.status}).`)
}

console.log('')
console.log(device.message || `Open ${device.verification_uri} and enter code ${device.user_code}`)
console.log('')
console.log(`Waiting for Microsoft sign-in. Token cache will be written to ${cachePath}`)

let intervalMs = Math.max(Number(device.interval || 5), 1) * 1000
const expiresAt = Date.now() + Number(device.expires_in || 900) * 1000

while (Date.now() < expiresAt) {
  await new Promise((resolve) => setTimeout(resolve, intervalMs))
  const { response: tokenResponse, payload: token } = await postForm(tokenEndpoint, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: clientId,
    device_code: device.device_code,
  })

  if (tokenResponse.ok) {
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify(token, null, 2), 'utf8')
    console.log(`Microsoft Graph token cache saved to ${cachePath}`)
    process.exit(0)
  }

  if (token.error === 'authorization_pending') continue
  if (token.error === 'slow_down') {
    intervalMs += 5000
    continue
  }

  throw new Error(token.error_description || token.error || `Token request failed (${tokenResponse.status}).`)
}

throw new Error('Microsoft sign-in timed out before a token was issued.')
