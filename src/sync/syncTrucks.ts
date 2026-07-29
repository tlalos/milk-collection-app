import { login } from '../api/authApi'
import { getRomOfflineSupplierVehicles } from '../api/trucksApi'
import { db } from '../db/database'
import { settingsStore } from '../store/settingsStore'
import type { LocalTruck } from '../types/trucks'

const TRUCKS_LAST_SYNC_KEY = 'trucks_last_sync'

export interface TruckSyncOptions {
  mode: string
  username: string
}

export async function syncTrucks(
  options: TruckSyncOptions,
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

  await db.trucks.clear()

  const trucks = await getRomOfflineSupplierVehicles(
    mode,
    username,
    signal,
    loginResponse.access_token,
  )

  const syncedAt = new Date().toISOString()
  const localTrucks: LocalTruck[] = trucks.map((truck) => ({
    ...truck,
    syncedAt,
  }))

  await db.transaction('rw', db.trucks, async () => {
    if (localTrucks.length > 0) {
      await db.trucks.bulkPut(localTrucks)
    }
  })

  localStorage.setItem(TRUCKS_LAST_SYNC_KEY, syncedAt)

  return localTrucks.length
}

export function getTrucksLastSync(): string | null {
  return localStorage.getItem(TRUCKS_LAST_SYNC_KEY)
}
