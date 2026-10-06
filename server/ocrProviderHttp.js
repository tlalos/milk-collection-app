import { Agent } from 'undici'

export function createOcrProviderClient(timeoutMs) {
  const agent = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connectTimeout: 30_000,
  })

  async function fetchJson(url, options, providerLabel) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, dispatcher: agent })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(`${providerLabel} API error: ${payload.error?.message || payload.message || response.statusText}`)
      return payload
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`${providerLabel} OCR timed out after ${Math.round(timeoutMs / 60_000)} minutes.`)
      if (String(error?.message || '').startsWith(`${providerLabel} API error:`)) throw error
      const detail = error?.cause?.code || error?.cause?.message || error?.message
      throw new Error(`${providerLabel} network request failed${detail ? `: ${detail}` : '.'}`)
    } finally {
      clearTimeout(timeout)
    }
  }

  return { agent, fetchJson }
}
