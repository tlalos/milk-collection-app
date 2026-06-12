import { login } from '../api/authApi'
import { getRomOfflineSuppliers } from '../api/suppliersApi'
import { db } from '../db/database'
import { settingsStore } from '../store/settingsStore'
import type { LocalSupplier } from '../types/suppliers'

const SUPPLIERS_LAST_SYNC_KEY = 'suppliers_last_sync'

export interface SupplierSyncOptions {
  mode: string
  username: string
}

export async function syncSuppliers(
  options: SupplierSyncOptions,
  signal?: AbortSignal,
): Promise<number> {
  const { apiUsername, apiPassword, defaultFiscalYear } = settingsStore.get()
  const mode = options.mode.trim()
  const username = options.username.trim()

  if (!apiUsername || !apiPassword) {
    throw new Error('API credentials not configured. Open Settings first.')
  }

  if (!mode) {
    throw new Error('Sync mode is required.')
  }

  if (!username) {
    throw new Error('Username is required.')
  }

  const loginResponse = await login(
    { Username: apiUsername, Password: apiPassword, fiscalyear: defaultFiscalYear },
    signal,
  )

  const suppliers = await getRomOfflineSuppliers(
    mode,
    username,
    signal,
    loginResponse.access_token,
  )

  const syncedAt = new Date().toISOString()
  const localSuppliers: LocalSupplier[] = suppliers.map((supplier) => ({
    ...supplier,
    syncedAt,
  }))

  await db.transaction('rw', db.suppliers, async () => {
    await db.suppliers.clear()
    if (localSuppliers.length > 0) {
      await db.suppliers.bulkPut(localSuppliers)
    }
  })

  localStorage.setItem(SUPPLIERS_LAST_SYNC_KEY, syncedAt)

  return localSuppliers.length
}

export function getSuppliersLastSync(): string | null {
  return localStorage.getItem(SUPPLIERS_LAST_SYNC_KEY)
}
