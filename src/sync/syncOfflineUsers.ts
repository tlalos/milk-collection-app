import { db } from '../db/database'
import { getOfflineUsers } from '../api/offlineUsersApi'

/**
 * Fetches offline users from the server and replaces the local copy in Dexie.
 * Returns the number of users stored.
 */
export async function syncOfflineUsers(signal?: AbortSignal): Promise<number> {
  const users = await getOfflineUsers(signal)
  await db.offlineUsers.clear()
  await db.offlineUsers.bulkPut(users)
  return users.length
}
