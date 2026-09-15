import type { AppSettings } from '../types/settings'
import { DEFAULT_SETTINGS } from '../types/settings'

const OCR_CONNECTION_SETTINGS_KEY = 'ocr_connection_settings'

export const ocrConnectionSettingsStore = {
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
