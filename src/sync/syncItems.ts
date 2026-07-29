import { login } from '../api/authApi'
import { getRomOfflineItems } from '../api/itemsApi'
import { db } from '../db/database'
import { settingsStore } from '../store/settingsStore'
import type { LocalItem } from '../types/items'

const ITEMS_LAST_SYNC_KEY = 'items_last_sync'

export interface ItemSyncOptions {
  mode: string
  username: string
}

export async function syncItems(
  options: ItemSyncOptions,
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

  await db.items.clear()

  const items = await getRomOfflineItems(
    mode,
    username,
    signal,
    loginResponse.access_token,
  )

  const syncedAt = new Date().toISOString()
  const localItems: LocalItem[] = items.map((item) => ({
    ...item,
    syncedAt,
  }))

  await db.transaction('rw', db.items, async () => {
    if (localItems.length > 0) {
      await db.items.bulkPut(localItems)
    }
  })

  localStorage.setItem(ITEMS_LAST_SYNC_KEY, syncedAt)

  return localItems.length
}

export function getItemsLastSync(): string | null {
  return localStorage.getItem(ITEMS_LAST_SYNC_KEY)
}
