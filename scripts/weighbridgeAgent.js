import 'dotenv/config'
import express from 'express'
import { getWeighbridgeConfig, readCurrentWeighbridgeWeight } from '../server/weighbridgeService.js'

const app = express()
const port = Number(process.env.WEIGHBRIDGE_AGENT_PORT || 8795)
const host = process.env.WEIGHBRIDGE_AGENT_HOST || '127.0.0.1'

app.use((request, response, next) => {
  const origin = request.headers.origin || '*'
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Private-Network', 'true')
  if (request.method === 'OPTIONS') return response.sendStatus(204)
  next()
})

app.get('/health', (_request, response) => {
  const config = getWeighbridgeConfig()
  response.json({
    ok: true,
    service: 'weighbridge-agent',
    config: {
      enabled: config.enabled,
      portName: config.portName,
      baudRate: config.baudRate,
      readWindowMs: config.readWindowMs,
    },
  })
})

app.get(['/current-weight', '/api/weighbridge/current-weight'], async (_request, response) => {
  try {
    const reading = await readCurrentWeighbridgeWeight()
    response.json({ ok: true, reading })
  } catch (error) {
    const config = getWeighbridgeConfig()
    response.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not read the weighbridge.',
      config: {
        enabled: config.enabled,
        portName: config.portName,
        baudRate: config.baudRate,
      },
    })
  }
})

app.listen(port, host, () => {
  const config = getWeighbridgeConfig()
  console.log(`Weighbridge agent running at http://${host}:${port}`)
  console.log(`Reading ${config.portName} at ${config.baudRate} baud`)
})
