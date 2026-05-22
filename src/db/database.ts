import Dexie, { type EntityTable } from 'dexie'
import type { UserSettings } from '../types/auth'

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
  user_id: number
  user_name: string
  user_password: string
  user_fullname: string
  user_isadmin: number
  user_settings: UserSettings | null
}

class MilkDb extends Dexie {
  collections!: EntityTable<Collection, 'id'>
  farmers!: EntityTable<Farmer, 'id'>
  syncLogs!: EntityTable<SyncLog, 'id'>
  offlineUsers!: EntityTable<OfflineUser, 'user_id'>

  constructor() {
    super('MilkCollectionDB')

    // v1 — original tables
    this.version(1).stores({
      collections: '++id, farmerId, barcode, collectedAt, synced',
      farmers: '++id, farmerId, barcode',
      syncLogs: '++id, table, status, timestamp',
    })

    // v2 — offline user store for local authentication
    this.version(2).stores({
      offlineUsers: 'user_id, user_name',
    })
  }
}

export const db = new MilkDb()
