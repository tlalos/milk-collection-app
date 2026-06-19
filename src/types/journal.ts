import type { MilkType } from '../types'

export type JournalErpStatus = 'pending' | 'sending' | 'sent' | 'failed'

export interface JournalEntry {
  id?: number
  collectionId: string
  collectionDate: string
  submittedAt: string
  supplierId: string
  supplierCode: string
  supplierName: string
  milkType: MilkType
  itemId?: number
  itemCode?: string
  itemDescription?: string
  itemMeasure?: string
  kg: number
  barcode: string
  waterPercentage: string
  temperature: string
  mobility: string
  erpStatus: JournalErpStatus
  erpMessage: string
  erpNewId: string
  erpSyncedAt: string | null
}
