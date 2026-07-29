import { login } from '../api/authApi'
import { getRomZgParam } from '../api/zgParamApi'
import { db } from '../db/database'
import { settingsStore } from '../store/settingsStore'
import type { LocalZgParam } from '../types/zgParam'

const ZG_PARAM_LAST_SYNC_KEY = 'zg_param_last_sync'

export interface ZgParamSyncOptions {
  username: string
}

export async function syncZgParam(
  options: ZgParamSyncOptions,
  signal?: AbortSignal,
): Promise<number> {
  const { apiUsername, apiPassword, defaultFiscalYear } = settingsStore.get()
  const username = options.username.trim()

  if (!apiUsername || !apiPassword) {
    throw new Error('API credentials not configured. Open Settings first.')
  }

  if (!username) {
    throw new Error('Username is required.')
  }

  const loginResponse = await login(
    { Username: apiUsername, Password: apiPassword, fiscalyear: defaultFiscalYear },
    signal,
  )

  await db.zgParams.clear()

  const params = await getRomZgParam(
    username,
    signal,
    loginResponse.access_token,
  )

  const syncedAt = new Date().toISOString()
  const firstParam = params[0]

  await db.transaction('rw', db.zgParams, async () => {
    if (firstParam) {
      const localParam = Object.assign({
        par_invoiceheaderline1: '',
        par_invoiceheaderline2: '',
        par_invoiceheaderline3: '',
        par_invoiceheaderline4: '',
        par_invoiceheaderline5: '',
        par_printformsupplier: '',
        par_printformbuyer: '',
        par_supplies_series1: '',
        par_from_branch: '',
        par_from_store: '',
        par_to_branch: '',
        par_to_store: '',
        id: 'current',
        username,
        syncedAt,
      }, firstParam) as LocalZgParam
      await db.zgParams.put(localParam)
    }
  })

  localStorage.setItem(ZG_PARAM_LAST_SYNC_KEY, syncedAt)

  return firstParam ? 1 : 0
}

export function getZgParamLastSync(): string | null {
  return localStorage.getItem(ZG_PARAM_LAST_SYNC_KEY)
}
