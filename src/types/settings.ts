export interface AppSettings {
  serverUrl: string
  defaultFiscalYear: string
  requestTimeoutMs: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: (import.meta.env.VITE_API_BASE_URL as string) ?? '',
  defaultFiscalYear: new Date().getFullYear().toString(),
  requestTimeoutMs: 15000,
}
