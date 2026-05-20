import Dexie, { type EntityTable } from 'dexie'

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

class MilkDb extends Dexie {
  collections!: EntityTable<Collection, 'id'>
  farmers!: EntityTable<Farmer, 'id'>
  syncLogs!: EntityTable<SyncLog, 'id'>

  constructor() {
    super('MilkCollectionDB')
    this.version(1).stores({
      collections: '++id, farmerId, barcode, collectedAt, synced',
      farmers: '++id, farmerId, barcode',
      syncLogs: '++id, table, status, timestamp',
    })
  }
}

export const db = new MilkDb()
