import type { AppSettings } from '../types/settings'
import { DEFAULT_SETTINGS } from '../types/settings'

const SETTINGS_KEY = 'app_settings'

export const settingsStore = {
  get(): AppSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (!raw) return { ...DEFAULT_SETTINGS }
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  },

  set(settings: AppSettings): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  },

  getServerUrl(): string {
    return this.get().serverUrl
  },
}
