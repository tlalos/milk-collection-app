import Dexie, { type EntityTable, type Table } from 'dexie'

export interface Collection {
  id: number
  farmerId: string
  farmerName: string
  barcode: string
  quantity: number
  fatContent: number
  collectedAt: Date
  synced: boolean
}

export interface Farmer {
  id: number
  farmerId: string
  name: string
  barcode: string
  location: string
  syncedAt: Date | null
}

export interface SyncLog {
  id: number
  action: string
  recordId: number
  table: string
  timestamp: Date
  status: 'pending' | 'synced' | 'failed'
}

/**
 * Raw object as returned by ERP_GetOfflineUsers.
 * Field names depend on the server's ERP_OfflineUsers C# class — we treat them
 * as unknown until confirmed, so we store the whole object and query by value.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OfflineUser = Record<string, any>

class MilkDb extends Dexie {
  collections!: EntityTable<Collection, 'id'>
  farmers!: EntityTable<Farmer, 'id'>
  syncLogs!: EntityTable<SyncLog, 'id'>
  offlineUsers!: Table<OfflineUser>

  constructor() {
    super('MilkCollectionDB')

    // v1 — original tables
    this.version(1).stores({
      collections: '++id, farmerId, barcode, collectedAt, synced',
      farmers: '++id, farmerId, barcode',
      syncLogs: '++id, table, status, timestamp',
    })

    // v2 — offline user store (initial, wrong key path — replaced in v3)
    this.version(2).stores({
      offlineUsers: 'user_id, user_name',
    })

    // v3 — use auto-increment key so any server shape is accepted
    this.version(3).stores({
      offlineUsers: '++_localId',
    })
  }
}

export const db = new MilkDb()
