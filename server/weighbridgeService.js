import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function getWeighbridgeConfig() {
  return {
    enabled: String(process.env.WEIGHBRIDGE_ENABLED || 'true').toLowerCase() !== 'false',
    portName: String(process.env.WEIGHBRIDGE_SERIAL_PORT || 'COM11').trim(),
    baudRate: Number(process.env.WEIGHBRIDGE_BAUD_RATE || 9600),
    readWindowMs: Number(process.env.WEIGHBRIDGE_READ_WINDOW_MS || 2500),
    powershellPath: process.env.WEIGHBRIDGE_POWERSHELL_PATH || 'powershell.exe',
  }
}

export function getPublicWeighbridgeConfig() {
  const source = String(process.env.WEIGHBRIDGE_SOURCE || 'server').trim().toLowerCase()
  const normalizedSource = source === 'local-agent' ? 'local-agent' : 'server'
  return {
    source: normalizedSource,
    agentUrl: String(process.env.WEIGHBRIDGE_AGENT_URL || 'http://127.0.0.1:8795').trim(),
  }
}

export function parseWeighbridgeLine(line) {
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

export function parseWeighbridgeText(text) {
  const lines = String(text || '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  const readings = lines.map(parseWeighbridgeLine).filter(Boolean)
  return {
    rawText: String(text || ''),
    lines,
    reading: readings[readings.length - 1] || null,
  }
}

let activeRead = null

export async function readCurrentWeighbridgeWeight() {
  if (activeRead) return activeRead
  activeRead = readCurrentWeighbridgeWeightNow().finally(() => {
    activeRead = null
  })
  return activeRead
}

async function readCurrentWeighbridgeWeightNow() {
  const config = getWeighbridgeConfig()
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
