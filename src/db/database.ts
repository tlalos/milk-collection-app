import Dexie, { type EntityTable, type Table } from 'dexie'
import type { LocalItem } from '../types/items'
import type { LocalSupplier } from '../types/suppliers'

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

export interface OfflineUser {
  _localId?: number     // Dexie auto-increment primary key
  username: string
  name: string
  offlinepassword: string
  offlinemode: string
}

class MilkDb extends Dexie {
  collections!: EntityTable<Collection, 'id'>
  farmers!: EntityTable<Farmer, 'id'>
  syncLogs!: EntityTable<SyncLog, 'id'>
  offlineUsers!: Table<OfflineUser>
  suppliers!: Table<LocalSupplier, number>
  items!: Table<LocalItem, number>

  constructor() {
    super('MilkCollectionDB')

    // v1 — original tables
    this.version(1).stores({
      collections: '++id, farmerId, barcode, collectedAt, synced',
      farmers: '++id, farmerId, barcode',
      syncLogs: '++id, table, status, timestamp',
    })

    // v2 — offline user store (wrong primary key — dropped in v3)
    this.version(2).stores({
      offlineUsers: 'user_id, user_name',
    })

    // v3 — drop so primary key can be changed in v4
    this.version(3).stores({
      offlineUsers: null,
    })

    // v4 — auto-increment key, no field-name assumption
    this.version(4).stores({
      offlineUsers: '++_localId',
    })

    // v5 — add username index for fast login lookup
    this.version(5).stores({
      offlineUsers: '++_localId, username',
    })

    this.version(6).stores({
      suppliers: 'sup_id, sup_code, sup_name, sup_type, sup_vatsts',
    })

    this.version(7).stores({
      items: 'item_id, item_code, item_descr, item_offline_type',
    })
  }
}

export const db = new MilkDb()
