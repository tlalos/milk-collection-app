import type { AppSettings } from '../types/settings'
import { DEFAULT_SETTINGS } from '../types/settings'
import { appPath } from '../ocrPaths'

const OCR_CONNECTION_SETTINGS_KEY = 'ocr_connection_settings'

export const ocrConnectionSettingsStore = {
  async getSharedUrl(): Promise<string> {
    const response = await fetch(appPath('/api/erp/connection'), { cache: 'no-store' })
    const payload = await response.json() as { serverUrl?: string; error?: string }
    if (!response.ok) throw new Error(payload.error || 'Could not load the shared ERP connection.')
    return payload.serverUrl || ''
  },

  async resolve(): Promise<AppSettings> {
    const serverUrl = await this.getSharedUrl()
    if (!serverUrl) throw new Error('Save the shared ERP URL in OCR connection settings before sending.')
    return { ...this.get(), serverUrl }
  },

  async saveShared(settings: AppSettings): Promise<void> {
    const url = new URL(settings.serverUrl.trim())
    const serverUrl = url.href.replace(/\/+$/, '')
    const response = await fetch(appPath('/api/erp/connection'), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serverUrl }),
    })
    const payload = await response.json() as { error?: string }
    if (!response.ok) throw new Error(payload.error || 'Could not save the shared ERP URL.')
    this.set({ ...settings, serverUrl })
  },
  get(): AppSettings {
    try {
      const raw = localStorage.getItem(OCR_CONNECTION_SETTINGS_KEY)
      if (!raw) return { ...DEFAULT_SETTINGS }
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  },

  set(settings: AppSettings): void {
    localStorage.setItem(OCR_CONNECTION_SETTINGS_KEY, JSON.stringify(settings))
  },
}
