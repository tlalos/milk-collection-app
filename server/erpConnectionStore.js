import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function normalizeErpUrl(value) {
  const url = new URL(String(value || '').trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('ERP URL must be an HTTP(S) base URL without credentials, query or fragment.')
  }
  return url.href.replace(/\/+$/, '')
}

export function createErpConnectionStore(settingsPath, legacyUrl = () => process.env.MONTHLY_INVOICE_ERP_URL) {
  return {
    async get() {
      try {
        const saved = JSON.parse(await readFile(settingsPath, 'utf8'))
        return { serverUrl: normalizeErpUrl(saved.serverUrl) }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        const legacy = legacyUrl()
        return { serverUrl: legacy ? normalizeErpUrl(legacy) : '' }
      }
    },
    async save(serverUrl) {
      const settings = { serverUrl: normalizeErpUrl(serverUrl) }
      await mkdir(path.dirname(settingsPath), { recursive: true })
      const temporary = `${settingsPath}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8')
      await rename(temporary, settingsPath)
      return settings
    },
  }
}

export const erpConnectionStore = createErpConnectionStore(fileURLToPath(new URL('../data/settings/erp-connection.json', import.meta.url)))
