import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

loadDotEnv(resolve(process.cwd(), '.env'))

const config = {
  enabled: String(process.env.WEIGHBRIDGE_ENABLED || 'true').toLowerCase() !== 'false',
  portName: String(process.env.WEIGHBRIDGE_SERIAL_PORT || 'COM5').trim(),
  baudRate: Number(process.env.WEIGHBRIDGE_BAUD_RATE || 9600),
  readWindowMs: Number(process.env.WEIGHBRIDGE_READ_WINDOW_MS || 2500),
  host: String(process.env.WEIGHBRIDGE_AGENT_HOST || '127.0.0.1').trim(),
  port: Number(process.env.WEIGHBRIDGE_AGENT_PORT || 8795),
  powershellPath: process.env.WEIGHBRIDGE_POWERSHELL_PATH || 'powershell.exe',
}

function loadDotEnv(path) {
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function parseWeighbridgeLine(line) {
  const text = String(line || '').trim()
  const match = /^(ST|US)\s*,\s*([A-Z]+)\s*,\s*([+-])\s*(\d+(?:[.,]\d+)?)\s*kg$/iu.exec(text)
  if (!match) return null
  const sign = match[3] === '-' ? -1 : 1
  const value = Number(String(match[4]).replace(',', '.'))
  if (!Number.isFinite(value)) return null
  return {
    raw: text,
    stable: match[1].toUpperCase() === 'ST',
    mode: match[2].toUpperCase(),
    weightKg: sign * value,
    unit: 'kg',
  }
}

function parseWeighbridgeText(text) {
  const lines = String(text || '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  const readings = lines.map(parseWeighbridgeLine).filter(Boolean)
  return {
    rawText: String(text || ''),
    lines,
    reading: readings[readings.length - 1] || null,
  }
}

async function readCurrentWeighbridgeWeight() {
  if (!config.enabled) throw new Error('Weighbridge integration is disabled.')
  if (!config.portName) throw new Error('WEIGHBRIDGE_SERIAL_PORT is not configured.')
  if (!Number.isFinite(config.baudRate) || config.baudRate <= 0) throw new Error('WEIGHBRIDGE_BAUD_RATE must be a positive number.')
  if (!Number.isFinite(config.readWindowMs) || config.readWindowMs <= 0) throw new Error('WEIGHBRIDGE_READ_WINDOW_MS must be a positive number.')

  const script = `
param([string]$PortName, [int]$BaudRate, [int]$ReadWindowMs)
$ErrorActionPreference = 'Stop'
$port = New-Object System.IO.Ports.SerialPort $PortName,$BaudRate,'None',8,'One'
$port.ReadTimeout = 500
$port.WriteTimeout = 500
try {
  $port.Open()
  Start-Sleep -Milliseconds $ReadWindowMs
  [Console]::Out.Write($port.ReadExisting())
}
finally {
  if ($port.IsOpen) { $port.Close() }
}
`
  const { stdout, stderr } = await execFileAsync(
    config.powershellPath,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& { ${script} }`, config.portName, String(config.baudRate), String(config.readWindowMs)],
    {
      timeout: config.readWindowMs + 5000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    },
  )

  if (stderr.trim()) throw new Error(stderr.trim())
  const parsed = parseWeighbridgeText(stdout)
  if (!parsed.rawText.trim()) throw new Error(`No data received from ${config.portName}.`)
  if (!parsed.reading) throw new Error(`Could not parse weighbridge data from ${config.portName}.`)
  return {
    ...parsed.reading,
    capturedAt: new Date().toISOString(),
    source: config.portName,
    baudRate: config.baudRate,
    rawLines: parsed.lines.slice(-5),
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
  })
  response.end(JSON.stringify(body))
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || `${config.host}:${config.port}`}`)
  if (url.pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      service: 'weighbridge-agent',
      config: {
        enabled: config.enabled,
        portName: config.portName,
        baudRate: config.baudRate,
        readWindowMs: config.readWindowMs,
      },
    })
    return
  }

  if (url.pathname === '/current-weight' || url.pathname === '/api/weighbridge/current-weight') {
    try {
      sendJson(response, 200, { ok: true, reading: await readCurrentWeighbridgeWeight() })
    } catch (error) {
      sendJson(response, 503, {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not read the weighbridge.',
        config: {
          enabled: config.enabled,
          portName: config.portName,
          baudRate: config.baudRate,
        },
      })
    }
    return
  }

  sendJson(response, 404, { ok: false, error: 'Not found.' })
})

server.listen(config.port, config.host, () => {
  console.log(`Weighbridge agent running at http://${config.host}:${config.port}`)
  console.log(`Reading ${config.portName} at ${config.baudRate} baud`)
})
