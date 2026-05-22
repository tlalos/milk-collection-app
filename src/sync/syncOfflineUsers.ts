import { login } from '../api/authApi'
import { getOfflineUsers } from '../api/offlineUsersApi'
import { db } from '../db/database'
import { settingsStore } from '../store/settingsStore'

/**
 * 1. Performs a temporary API login using the credentials stored in Settings.
 * 2. Fetches ERP_GetOfflineUsers with the returned token (does NOT overwrite the
 *    current user's session — the token is used only for this call).
 * 3. Replaces the local offlineUsers table and returns the number of records stored.
 */
export async function syncOfflineUsers(signal?: AbortSignal): Promise<number> {
  const { apiUsername, apiPassword, defaultFiscalYear } = settingsStore.get()

  if (!apiUsername || !apiPassword) {
    throw new Error(
      'API credentials not configured. ' +
      'Go to Settings and enter the API username and password first.'
    )
  }

  // Step 1: login to get a bearer token
  const loginResponse = await login(
    { Username: apiUsername, Password: apiPassword, fiscalyear: defaultFiscalYear },
    signal,
  )

  // Step 2: fetch users using that token (bypasses any stored session token)
  const users = await getOfflineUsers(signal, loginResponse.access_token)

  // Log the first record so we can verify the actual field names from the server
  if (users.length > 0) {
    console.log('[syncOfflineUsers] sample record keys:', Object.keys(users[0]))
    console.log('[syncOfflineUsers] sample record:', users[0])
  }

  // Step 3: replace local copy
  await db.offlineUsers.clear()
  await db.offlineUsers.bulkPut(users)

  return users.length
}
